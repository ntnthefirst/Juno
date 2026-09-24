# Verification rules

What must pass before a change counts as done, and the traps in this stack.

---

## 1. The commands

Run from the repo root. The project uses npm.

| Command | Checks | Run it |
| --- | --- | --- |
| `npm run dev` | Vite, a main-process watch and Electron, against a separate development data directory | To actually look at the change |
| `npm run dev:clean` | The same, after deleting that directory: empty database, no accounts, no seeds | To test a first run or a migration from empty. `npm run dev -- --clean` is the same thing |
| `npm run lint` | ESLint: unused imports, bad hook use, missing `key`, a node import reaching `src/` | After every change |
| `npm run typecheck` | `tsc --noEmit` across renderer, preload and main | After every change touching types, props, schema or a service signature |
| `npm run test` | Vitest. Service functions and migrations | After every change to a service, a query or the schema |
| `npm run check` | lint, typecheck and test in one go | Before a commit |
| `npm run smoke` | Compiles, launches the packaged-mode app, asserts the DB opened, migrations ran and both windows painted, exits | Before any commit touching main, preload, the schema, the windows or a native module |
| `npm run compile` | Main process plus renderer, no installer | When you only need built output, not a package |
| `npm run build` | Everything, then an installer for the current platform, into `release/` | Before claiming the app ships, and after touching a native dependency |
| `npm run build:win` / `build:mac` / `build:linux` | The same for one named platform | CI. Each runner builds the platform it is |
| `npm run icons` | Redraws `build/icon.png` and the NSIS installer artwork from `brand/logo/` | After a brand change |
| `npm run db:generate` | Drizzle turns a schema change into a migration file | After editing anything under `electron/main/db/schema/` |
| `npm run db:migrate` | Applies pending migrations forward | After generating one, and on a copy of the real database before the real one |

Set `JUNO_SMOKE_DEMO=1` on a smoke run to seed a demo business, walk every
screen and the settings window, and write a screenshot of each in both themes
to `.smoke/`. That is the fastest honest look at a visual change.

These names are the canonical set. A skill or a script that invents a different
one (`npm run package`, `npm run dist`) is wrong and should be corrected to match.

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
2. Otherwise `preview_start` with the `juno-renderer` config in
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
- **A white window in `npm run dev` is the content policy, not React.**
  Vite's React plugin injects its refresh preamble inline, so `script-src
  'self'` blocks it and every module the plugin touched then throws on
  `$RefreshReg$`. Nothing appears in the terminal: the only evidence is in the
  renderer console, which a frameless window with no menu does not open on its
  own. The development policy carries a nonce for exactly this
  ([security.md](security.md)).
- **A migration that was renamed stays behind in `dist-electron` and runs again.**
  The migrations are copied out of the source tree next to the compiled main
  process, and the runner applies every `.sql` it finds there by file name. A
  file that was renamed or regenerated leaves its old copy in the build folder,
  that name is not in `_migrations`, so it runs on the next launch and fails on
  a table it already created. The app then refuses to open, and nothing names
  the file, because the file is no longer in the repo. `scripts/after-main.mjs`
  empties the destination before copying for this reason. If a launch fails on
  "table X already exists", list `dist-electron/main/db/migrations` and compare
  it with the source folder.
- **Never write to the app's database with a different SQLite than the app
  uses.** `node:sqlite` under the host's Node is not the build Electron ships,
  and a write from the wrong one can leave the file with a schema page that
  parses on one and not on the other ("malformed database schema ... orphan
  index"). Anything that has to touch a real database outside the app runs
  under `ELECTRON_RUN_AS_NODE=1 electron`, with the app closed, on a copy
  first.
- **`capturePage()` hands back the frame before the change.** It resolves
  against whatever the compositor last produced, so a screenshot taken straight
  after toggling the theme or opening a screen shows the previous one. A run
  that changes one thing between captures writes a whole folder that is off by
  one, with each light and dark pair identical, and nothing anywhere says so.
  The smoke run waits for two animation frames before every capture. If a set
  of `.smoke/` images all look plausible and each pair matches, compare their
  hashes before trusting them.
- **`tsBuildInfoFile` without `"incremental": true` does nothing at all.** tsc
  writes no build info and recompiles the whole program on every run, including
  the first pass of a `--watch`. It looks configured and is not.
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
