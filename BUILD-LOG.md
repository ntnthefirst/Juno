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
| **Runs?** | No window yet. The data layer is proven end to end |
| **Last verified** | Migrations, Drizzle reads and writes, transactions and foreign keys, all inside Electron |

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
