# Build log

A running record of what has been built, what was changed from the plan, and
why. **Read this first if you are picking the project up cold.** It is written
so a fresh session can continue without the conversation that produced it.

Newest entries at the bottom. Keep it current as you work: an entry per session,
and an entry per deviation from [PLAN.md](PLAN.md) or [docs/decisions.md](docs/decisions.md).

---

## Where the project stands

| | |
| --- | --- |
| **Phase** | 0 and 1 complete. Auto-update is the only phase 0 item left, blocked on the repository existing |
| **Runs?** | **Yes, including packaged.** Clients, documents with PDF generation and signing, templates, reference data, lock, backup and settings |
| **Last verified** | lint, typecheck, 76 tests, and a smoke run that generates a document through the bridge and photographs four screens in both themes |

### What exists

- The full document set: `PLAN.md`, `docs/decisions.md`, `CLAUDE.md`,
  `START-HERE.md`, `.claude/rules/*` (8 files), `.claude/skills/*` (7 skills),
  `brand/` (tokens, logo, preview page).
- `package.json` with the canonical scripts from
  [.claude/rules/verify.md](.claude/rules/verify.md) section 1.
- Dependencies installed and resolving.

### What exists and is proven

- Build pipeline: the main process is TypeScript compiled to CommonJS in
  `dist-electron/`, the renderer is Vite. `npm run build:main` works.
- `electron/main/db/`: the shim, the five standard columns with UUIDv7, the
  first schema (clients, contacts, projects, reference_sets, reference_items),
  the generated migration and a forward-only migration runner.
- A full-stack test was run inside Electron and passed: migrations apply and
  re-running is a no-op, Drizzle inserts, selects, updates, orders and joins
  through the shim, UUIDv7 validates against the spec, `owner_id` and UTC
  timestamps default correctly, soft deletes filter, booleans and integers
  round-trip, transactions roll back, and foreign keys are enforced.

### What does not exist yet

No window, no preload, no services, no IPC, no MCP, no renderer.

---

## Environment facts, verified on this machine

Checked empirically rather than assumed. Re-check if the machine changes.

| Fact | Value | How it was checked |
| --- | --- | --- |
| Host Node | 23.9.0, ABI 131 | `node -v` |
| npm | 11.6.1 | `npm -v` |
| Electron | 41.10.7 | resolved by npm |
| Electron's Node | **24.18.0**, ABI 145 | ran a script under `npx electron` |
| Bundled SQLite | **3.53.1**, via `node:sqlite` | opened a database and ran a query inside Electron |
| Visual Studio | **2026 Community, no C++ workload** | `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` returned nothing |
| Windows SDK | **absent** | no `C:\Program Files (x86)\Windows Kits\10\Include` |

**The machine cannot compile native modules.** No `cl.exe`, no Windows SDK. This
is the single most consequential environment fact and it drove the storage
decision below.

---

## Deviations from the original plan

Anything here overrides the earlier document, and the reason is recorded so it
can be reversed if the reason stops being true.

### 1. Storage is `node:sqlite`, not `better-sqlite3`

`docs/decisions.md` decision 3 named `better-sqlite3`. It cannot be used on this
machine: it is a `node-gyp` module, there is no C++ compiler, and `npm install`
fails at `find VS`. Even with a compiler it would need rebuilding against
Electron's ABI on every Electron bump, which
[.claude/rules/verify.md](.claude/rules/verify.md) already lists as a trap.

`node:sqlite` is in the Node standard library, is synchronous (the property
decision 3 actually wanted), needs no compilation, has no ABI to mismatch, and
removes the `.node` asar-unpacking problem from packaging. Verified working
inside Electron before committing to it.

Cost: it is still marked experimental, and Drizzle has no driver for it.

**Recorded as decision 18.**

### 2. A shim makes `node:sqlite` look like `better-sqlite3` to Drizzle

Drizzle ships `better-sqlite3`, `bun-sqlite`, `libsql`, `expo-sqlite`,
`op-sqlite` and `sqlite-proxy` drivers, but nothing for `node:sqlite`.

The API surfaces were compared method by method inside Electron:

| Drizzle needs | `node:sqlite` has | Shim |
| --- | --- | --- |
| `stmt.raw(bool)` | `stmt.setReturnArrays(bool)` | rename, return `this` |
| `db.transaction(fn)` | nothing | wrap `BEGIN` / `COMMIT` / `ROLLBACK` |
| `prepare`, `exec`, `run`, `get`, `all` | all present, same shape | pass through |

Verified that `setReturnArrays(true)` really does yield `[["x",1],["y",2]]`, and
that manual `BEGIN`/`ROLLBACK` works.

`sqlite-proxy` was the alternative. It is the officially supported escape hatch,
but it forces an async API and has weak transaction support, which is a worse
trade than a 30-line shim over an API surface that has now been measured.

**Risk to watch:** the shim depends on how Drizzle's better-sqlite3 session calls
the driver. If a Drizzle upgrade breaks, the fix is one file. Pin the Drizzle
minor version and read its changelog before upgrading.

### 3. The lock derives its secret with scrypt, not Argon2id

Recorded as decision 17, before the compiler problem was found. The same reason
applies twice over now: Argon2 needs a native module, and this machine cannot
build one.

### 4. `postinstall` was removed from `package.json`

It ran `electron-builder install-app-deps`, which exists to rebuild native
modules. With no native dependencies it does nothing. Put it back the moment a
native dependency is added.

---

## Session entries

### Session 1

Scaffolding started. Wrote `package.json` against the canonical script names,
hit the `better-sqlite3` compile failure, diagnosed the toolchain, verified
`node:sqlite` in Electron, and chose the storage path above.

Nothing runs yet.


### Session 1, continued

Data layer built and proven. Two findings worth keeping:

**Drizzle's `drizzle()` from `drizzle-orm/better-sqlite3` cannot be used.** It
does a top-level `require("better-sqlite3")` and throws before it looks at the
client you hand it, even though on that path it never uses the import. The
database is therefore assembled by hand in `electron/main/db/index.ts` from
`SQLiteSyncDialect`, `BetterSQLiteSession` and `BaseSQLiteDatabase`, which are
all published subpath exports, mirroring what its own `construct()` does. A fake
`better-sqlite3` package and a `Module._load` patch were both considered and
rejected as more fragile.

**`raw()` must not be sticky.** Drizzle reuses one prepared statement for both
object rows and array rows, so the shim sets `setReturnArrays` for the duration
of a single call and clears it in a `finally`. Leaving it on returns the wrong
shape to whichever caller comes second, which would have been a subtle and
horrible bug.

The migration runner splits on drizzle-kit's `--> statement-breakpoint` marker
rather than on semicolons, and applies each file in one transaction, so a
half-applied migration cannot leave the journal disagreeing with the schema.


### Session 1, part 3: the app boots

`npm run build:main && node scripts/smoke.mjs` launches the real application
against a throwaway user-data directory. It migrates, opens a window, and serves
the renderer over `app://bundle`. Confirmed in the smoke output.

Built in this part:

- `electron/main.ts`, with the boot order spelled out in a comment because it
  matters: scheme privileges before ready, single instance, database, lock, IPC,
  window last.
- `electron/main/scheme.ts`, serving the packaged renderer over `app://bundle`
  with a path-traversal guard.
- `electron/main/windows/main-window.ts`, with the CSP, the external-link
  handler and the navigation guard.
- `electron/preload.ts`, exposing methods rather than `ipcRenderer`.
- `electron/main/vault.ts` and `services/lock.ts`.
- `electron/main/ipc/lock-guard.ts`.
- The renderer shell: `src/app/{App,Sidebar,TitleBar}.tsx`,
  `src/components/LockScreen.tsx`, `src/features/clients/ClientsScreen.tsx`,
  `src/lib/theme.ts`, `src/styles/`.
- `scripts/smoke.mjs`.

**Findings worth keeping:**

- **The lock guard is a wrapper, not a per-handler check.** `installLockGuard()`
  replaces `ipcMain.handle` before anything registers, so a new channel is
  refused while locked by default and has to be named in `ALLOWED_WHILE_LOCKED`
  to get through. It must keep running first in `ipc/index.ts`.
- **Electron 41 changed the `console-message` signature.** The positional form
  still fires but warns on every message. Use the single event object with
  `event.level` as a string.
- **The preload path is `join(__dirname, "..", "..", "preload.js")`** from
  `dist-electron/main/windows/`. One `..` too few silently produces a window with
  no bridge and no error.
- The renderer bundles Inter and JetBrains Mono locally, per decision 10. Vite
  emits them into `dist/assets`, so the app has no font CDN dependency.

**Still missing at the end of this part:** the clients, contacts, projects,
search, reference, settings and backup services, and their IPC and MCP adapters.
Two agents were writing them in parallel. The smoke run correctly failed on
`settings.getTheme` and `clients.list` having no handler, which is exactly what
the smoke script exists to catch.


### Session 1, part 4: services wired, lint clean, packaging works

`npm run lint`, `npm run typecheck` and `npm run test` (29 tests) are all clean,
and `npx electron-builder --win` produces a working installer.

**Environment problems found and fixed:**

- **Tests cannot run on the host's Node 23.9.** Its `node:sqlite` has no
  `StatementSync.setReturnArrays`, which the shim's `raw()` needs, so every
  Drizzle select throws. The `test` script now runs Vitest under Electron's Node
  24.18 via `ELECTRON_RUN_AS_NODE=1`. If the host Node is ever upgraded past 24
  this can go back to plain `vitest`.
- **`tsconfig.main.json` was emitting the test files** into `dist-electron`,
  where Vitest collected the compiled CommonJS copies and failed on
  `require("vitest")`. Excluded there, and `vitest.config.ts` excludes the output
  directories too.

**A real bug in the shim, found by a subagent:** Drizzle does not call the
function returned by `transaction()`. It calls `tx[behavior ?? "deferred"](...)`.
The shim returned a bare function, so every transaction threw. It now returns a
callable carrying `deferred`, `immediate` and `exclusive`. Worth remembering that
a type check passed on this and only running it caught it.

**Layering fix:** `settings.ts` and `backup.ts` had reached for `db/paths.ts`
through a lazy `require()`, to avoid pulling Electron into a plain Node test.
`main.ts` now injects the directories at startup instead, so no service knows
about paths and none imports Electron.

**Two React purity errors** in the lock screen, both real and both caught by
lint, not by types: reading the clock during render, and calling setState
straight from an effect body. The countdown now changes state only inside the
interval callback.

**Packaging:**

- `scripts/make-icon.mjs` rasterises the SVG to `build/icon.png` using Electron
  itself, since adding sharp or resvg would mean a native module. Note that
  `capturePage()` returns device pixels, so the window is sized in CSS pixels
  divided by the display scale factor, or a 1.5x display yields a 1536px image.
- `electron-builder.yml` deliberately has **no `publish` block**. The repository
  does not exist online yet, and an installed build pointing at the wrong feed is
  worse than one that never checks. Add it, and enable the updater, once the repo
  is created.
- The **packaged** app was launched and verified, not just built. It migrates
  from inside the asar and serves the renderer over `app://bundle`.

**Still missing for phase 0:** the client create/edit/detail interface, the
settings screen (theme, lock configuration, reference-data editor, backup), and
auto-update.


### Session 1, part 5: the lock's crypto, and a bug that would have shipped

`vault.ts` imports `electron`, and the test runner is plain Node, so the code
that decides whether a wrong passphrase gets in had no test. The pure parts were
extracted into `vault-core.ts`.

**The first run of those tests failed, and this is the entry to remember.**
scrypt needs `128 * N * r` bytes. At `N = 2^15` and `r = 8` that is exactly
32 MiB, and Node's default `maxmem` is also 32 MiB, so every derivation threw
`MEMORY_LIMIT_EXCEEDED`. Nothing about this is visible to a typecheck, and the
failure mode in production would have been ugly: configuring a lock writes the
vault first, so the app would have accepted the new passphrase and then refused
every unlock attempt afterwards, with the lock already on.

`maxmem` is now explicit and stored in the record alongside `N`, `r`, `p` and
`keylen`, so raising the cost parameters later cannot invalidate a verifier that
already exists. Verification reads the parameters from the record rather than
from the current constant, for the same reason.

If `N` is ever raised, check `128 * N * r` against `maxmem` in the same edit.


### Session 1, part 6: the client interface, and a layout bug only a screenshot caught

Clients, contacts and projects can now be created, edited, deleted and restored
from the interface. `src/components/` gained Dialog, Button, Field, Select and
Toast; `src/features/clients/` gained ClientForm, ContactForm, ProjectForm and
ClientDetail.

**The smoke script now drives the real bridge.** With `BUREAU_SMOKE_DEMO=1` it
calls `window.bureau.*` to create four clients, a primary contact and two
projects, reloads, clicks a row, and screenshots both themes. This exercises
IPC, the services and SQLite exactly as a person clicking would. Verifying the
interface against a mock would prove nothing about any of them.

**The bug it caught:** contact and project rows used fixed-width columns for
role, phone, due date and amount. Measuring the rendered row showed the name had
collapsed to **31px** while an empty phone column still reserved **120px**, so
"Laura" rendered as "La...". Typecheck, lint and tests were all clean throughout.

Both rows are now two lines: name and badge on the first, the metadata that
actually exists joined on the second. Missing fields take no space at all. The
general lesson is that a fixed-width column in a flex row is a promise that the
field is always populated, and in a CRM most fields are not.

Also confirmed working: integer cents render as `2 100,00` in Belgian format,
`YYYY-MM-DD` dates render as `14/11/2026` without passing through a Date, status
tones resolve from token names, and the seeded reference data drives both status
dropdowns.


### Session 1, part 7: the settings screen, and phase 0 closing out

Settings covers appearance, lock, statuses and labels, owner details, backup and
about. `src/features/settings/`, one file per section.

**Three lint errors of the same kind, worth knowing about.** React's
`react-hooks/set-state-in-effect` rejects calling a setState-containing function
directly from an effect body, even an async one that only sets state a microtask
later. The accepted shape is a promise chain whose callback sets the state:

```ts
useEffect(() => {
	let cancelled = false;
	window.bureau.thing.list()
		.then((v) => { if (!cancelled) setThing(v); })
		.catch((e: unknown) => { if (!cancelled) setError(messageOf(e)); });
	return () => { cancelled = true; };
}, []);
```

Keep the `refresh()` callback for use after a mutation; just do not call it from
the effect body. `messageOf` moved to `src/lib/errors.ts` because a file that
exports both components and a helper breaks fast refresh.

**A real ordering bug the screenshots caught.** `reference.listSets` ordered by
label, which put Document status between Client status and Project status.
Alphabetical order is an accident here; the sets now follow the order
`seed-data.ts` declares them in, which matches how the records relate. Nothing in
lint, typecheck or the tests could have found this.

The smoke run now walks both screens in both themes, scrolling through settings
because it is taller than the window. Eight images per run.

**What is left in phase 0:** auto-update. It is deliberately not built, because
`electron-builder.yml` has no publish block until the repository exists, and an
installed build pointing at the wrong feed is worse than one that never checks.

**Phase 0's done-when, from PLAN.md,** is now reachable: install the packaged
build, enter the four clients with contacts and projects, reboot, and confirm
they are still there.


### Session 1, part 8: phase 1

A template is HTML with placeholders, rendered against a client, printed to PDF
in an offscreen window and stamped with a signature, a timestamp and a SHA-256.

**Decision 19 amends decision 8.** The plan had docxtemplater filling `.docx`
and `printToPDF` rendering HTML, and never said how a filled `.docx` becomes the
signed PDF. It cannot without LibreOffice or a paid API. Templates are HTML now.
Nathan confirmed this was fine: it was never meant to be a Word editor.

**The specimen mechanism.** Every shipped template is invented, so this is
structural rather than a note in a file:

- Templates seed with `reviewedAt: null`.
- `isSpecimen` is recorded **on the document**, not looked up, so reviewing a
  template later cannot reclassify a contract that has already gone out.
- The red banner comes from `documentShell`, not from any template body, so it
  cannot be edited out.
- `documents.assertSignable` refuses outright, and it lives in a module with no
  Electron import specifically so a test covers it.
- No MCP tool marks a template reviewed, and none signs. Both are claims a person
  has to make.

**Traps and findings:**

- **An offscreen window cannot see the renderer's bundled fonts.** The two Inter
  faces are copied beside the main process by `after-main.mjs` and inlined as
  data URIs at render time. Without that a contract prints in whatever the
  machine happens to have, which is different on every machine.
- **`printToPDF` needs a settling delay after `loadURL` resolves.** `loadURL`
  resolves on `did-finish-load`, but layout with a just-decoded webfont settles a
  frame later, and the first page prints in the fallback face without it.
- **Reading the generated PDF caught a raw ISO timestamp** printed on a
  client-facing page. Now formatted, with the exact UTC kept on the audit page.
- **The renderer CSP allows `img-src data:` but not `file:`.** The signature
  preview therefore comes back from the main process as a data URL. Widening the
  policy would let a renderer bug read arbitrary local images.
- The preview iframe carries `sandbox=""`, with no privileges at all.

**What phase 1 does not do:** `.docx` import or export. Neither is on the path to
a signed PDF, and both are reasonable later additions.
