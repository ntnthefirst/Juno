# Verification rules

What must pass before a change counts as done, and the traps in this stack.

---

## 1. The commands

Run from the repo root. The project uses npm.

| Command | Checks | Run it |
| --- | --- | --- |
| `npm run lint` | ESLint: unused imports, bad hook use, missing `key`, a node import reaching `src/` | After every change |
| `npm run typecheck` | `tsc --noEmit` across renderer, preload and main | After every change touching types, props, schema or a service signature |
| `npm run test` | Vitest (the obvious default for a Vite project; decisions.md does not name one). Service functions and migrations | After every change to a service, a query or the schema |
| `npm run smoke` | Launches the packaged-mode app, waits for the window, asserts the DB opened and migrations ran, exits | Before any commit touching main, preload, the schema or a native module |
| `npm run build` | Vite build plus electron-builder package | Before claiming the app ships, and after touching a native dependency |
| `npm run dev` | Vite dev server plus Electron | To actually look at the change |

Fix forward between steps and re-run the step that failed plus everything after
it. Don't reorder: a type error makes the build fail with a worse message.

`npm run lint` and `npm run typecheck` passing proves nothing about the packaged
app. Native modules, the preload bridge and the custom scheme only break when
packaged, which is what `smoke` is for.

## 2. Never suppress instead of fixing

No `--no-verify`, no `eslint-disable-next-line`, no `@ts-ignore`, no
`@ts-nocheck`, no widening to `any`, no `as unknown as T` to get past an error.

If a rule genuinely fires wrongly, say so explicitly in the response, keep the
suppression to one line, and put the reason in a comment next to it. A silent
suppression in a service is a business rule that stopped being checked.

## 3. Looking at it

A clean typecheck is not proof a screen works.

1. `preview_list` first. If a dev server is already running, reuse it.
2. Otherwise `preview_start` with the `bureau-renderer` config in
   `.claude/launch.json`. That serves the renderer alone; main-process behaviour
   still has to be checked in the real app.
3. Check the screen in **both themes**. Toggle `data-theme` on `<html>`; don't
   assume the tokens handled it ([styling.md](styling.md)).
4. Look for: a row taller than 36px, an unreadable `--ink-faint` label, numbers
   that are not `tabular`, a focus ring you cannot see, a column that wraps.
5. Read the console for renderer errors, and the terminal for main-process errors.
   They are two different places and a main-process throw shows only in the second.
6. For anything touching mail or documents, run it against a real account or a
   real template once. A fixture that never saw a real multipart message proves
   nothing.

## 4. Traps in this stack

- **`better-sqlite3` is a native module and must be rebuilt against Electron's
  ABI, not Node's.** Installing it normally builds for your system Node, and then
  `npm run dev` throws `NODE_MODULE_VERSION mismatch` on the first query.
  `electron-rebuild` (or the builder's install step) runs after every `npm install`
  and after every Electron version bump. If the app worked yesterday and throws on
  startup today, check this first.
- **Drizzle migration ordering is file order, and a merge breaks it.** Two
  migrations generated on two branches get the same number or apply in the wrong
  sequence, and the journal will disagree with the folder. After any merge that
  touches `db/migrations/`, regenerate rather than hand-merge. **Never edit an
  applied migration** ([data.md](data.md)).
- **`safeStorage` returns unusable data before `app.whenReady()`.** Called too
  early it can report encryption unavailable, or hand back a buffer that decrypts
  to garbage on the next launch, which looks exactly like a wrong password. Every
  vault call happens after ready, and `isEncryptionAvailable()` is checked before
  the first write.
- **An IMAP connection that is not closed leaks, and the server starts refusing
  you.** `imapflow` clients need `logout()` in a `finally`, including on the error
  path and on `before-quit`. Most providers cap concurrent connections at a low
  single digit, so a sync that throws three times locks the account out for
  minutes. Symptom: sync works on a fresh launch and fails after a few retries.
- **A timestamp stored as local time is a bug that appears twice a year.** Brussels
  is UTC+1 or UTC+2 depending on the date, so a deadline written in October is an
  hour off in April, and a date stored as local midnight lands on the previous day.
  Store UTC ISO-8601, convert only when rendering. Test with the machine clock set
  to a DST boundary, not with today's date.
- **`printToPDF` on a window that has not finished loading produces a blank or
  half-rendered page, and does not error.** Wait for `did-finish-load`, then for
  fonts (`document.fonts.ready`) and any image, before calling it. An offscreen
  window that is never shown still needs this. A blank PDF in the output folder is
  this trap every time.
- **A Tailwind token that does not exist renders nothing and reports nothing.**
  `bg-accent-strong` when only `--accent-hover` exists produces no class, no lint
  error, no build error. If a colour is not applying, check the name in
  `src/styles/tokens.css` and the `@theme inline` block before changing anything
  else ([styling.md](styling.md)).
- **Renderer code importing a node-only module works in dev and breaks when
  packaged.** Vite resolves `path`, `fs` or `better-sqlite3` in the dev server and
  then ships a broken bundle, or the import silently pulls a browser shim that
  behaves differently. Anything under `src/` that needs main-process work goes
  through the preload bridge. A shared type is imported with `import type`, which
  erases at build time.
- **A `Date` object does not survive IPC intact in a way you should rely on.**
  Structured clone will carry it, but the MCP path serialises to JSON. Pass ISO
  strings across both adapters so the two callers get the same thing.
- **`app.getPath("userData")` differs between the dev app and the packaged app**
  unless the product name matches. A dev run that "loses the database" is usually
  pointing at a second file, not a corrupted one.

## 5. Definition of done

- [ ] `npm run lint` clean.
- [ ] `npm run typecheck` clean.
- [ ] `npm run test` clean, including a test for the service function you changed.
- [ ] `npm run smoke` clean, for anything touching main, preload, schema or a
      native module.
- [ ] Looked at in the app, in **both** light and dark.
- [ ] No errors in the renderer console or the main-process terminal.
- [ ] New table: all five standard columns, indexes on foreign keys, soft-delete
      filter in every read ([data.md](data.md)).
- [ ] New capability: service function, IPC handler **and** MCP tool, in the same
      commit ([mcp.md](mcp.md)).
- [ ] Anything that sends, signs, deletes or files: confirmation enforced in the
      service, never unattended.
- [ ] No secret in the DB, the renderer, a log line or the repo
      ([security.md](security.md)).
- [ ] Copy sweep run for AI tells and attribution ([writing.md](writing.md) section 7).
- [ ] Committed per [git.md](git.md), with no AI attribution.

Only report work as done when every box is genuinely ticked. If something is
blocked or skipped, say which one and why.
