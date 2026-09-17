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
| **Phase** | 0, in progress |
| **Runs?** | **Yes, including packaged.** `release/Bureau-Setup-0.1.0-x64.exe` builds and the installed app boots |
| **Last verified** | The packaged exe migrates, seeds 4 sets and 17 items, and paints over `app://bundle` |

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
