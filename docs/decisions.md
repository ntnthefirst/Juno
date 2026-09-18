# Decisions

The choices everything else assumes. One entry per decision: what was chosen, and
the reason that would have to stop being true for it to change.

---

## 1. Electron + React + TypeScript + Vite

Mirrors `parrel-cockpit-desktop`, which already works, ships and has CI. A second
desktop stack would mean learning two sets of traps for no gain.

## 2. The services layer is the API. IPC and MCP are thin adapters.

**The most important rule in the project.** Every capability is implemented once,
in `electron/main/services/<domain>.ts`. Two adapters sit on top and neither is
allowed to contain logic:

```
electron/main/services/clients.ts     <- the only place client logic exists
electron/main/ipc/clients.ts          <- thin: unwraps args, calls the service
electron/main/mcp/clients.ts          <- thin: declares the tool, calls the service
```

Consequences, all intentional:

- Anything the UI can do, an agent can do, on the day the feature ships.
- An automation is a recorded sequence of service calls, not a second engine.
- Writing a feature twice, once for the UI and once for the agent, is a bug.

If a service function is hard to expose as an MCP tool, the service has the wrong
shape. Fix the service, don't special-case the adapter.

## 3. SQLite via better-sqlite3, typed with Drizzle

Local file, synchronous API, no server, no daemon. Drizzle gives a typed schema
and generated migrations, which matters because the schema is large and most of
the code is written against it.

Migrations are committed and run forward on launch. Never edit a migration that
has been applied on a real machine; add a new one.

## 4. Every row: UUIDv7 id, `owner_id`, `created_at`, `updated_at`, `deleted_at`

Non-negotiable, on every table, from the first migration.

- **UUIDv7**, not autoincrement: two machines syncing integer ids is unfixable.
  v7 over v4 because it is time-sortable, so it indexes well.
- **`owner_id`** even while there is exactly one owner. It is the column that
  decides who sees what the day a colleague or a sync server appears.
- **`deleted_at`** soft deletes: a sync that hard-deletes cannot distinguish
  "deleted" from "not yet received".
- **UTC ISO-8601** for every timestamp. Local time is a display concern only.

Retrofitting any of these is a rewrite. Adding them now is four columns.

## 5. Local-first, and offline is the normal case

The SQLite file is the source of truth, always. Mail is pulled down and stored
locally; the app opens and works with no network. Anything remote is a sync that
reconciles into local state, never a read the UI blocks on.

This is also what makes the app free to run: there is no server to pay for.

## 6. Credentials never touch the renderer or the database

Mail passwords and tokens go in Electron `safeStorage` (Windows DPAPI, macOS
Keychain), keyed by account id. The database stores a *reference*, never a secret.
Every network call using a credential is made in the main process.

The renderer says "sync account X". It has no API that returns a password. This
mirrors the model already proven in `parrel-cockpit-desktop`.

Nothing account-related belongs in the build: no `.env`, no `electron-builder`
entry, no CI secret. Accounts are data the user enters at runtime. Only the
code-signing certificate and the update-feed URL are build configuration.

## 7. Mail: imapflow + mailparser + nodemailer

Maintained, promise-based, and they do not assume a browser. Sync is read-only
first: pull, store, display, link to a client. Composing and sending come later,
as a separate phase, because they are separate risk.

## 8. Documents: docxtemplater, Electron `printToPDF`, pdf-lib

- **docxtemplater** fills the existing `.docx` contracts with placeholders. The
  templates stay editable in Word, which matters because they are legal text.
- **`printToPDF`** renders HTML templates to PDF using the Electron already
  present. No headless browser, no LibreOffice, no extra binary.
- **pdf-lib** stamps a signature PNG onto a PDF and appends the audit page.

**Signing scope:** a signature image plus timestamp plus audit trail. That is
appropriate for low-stakes and internal documents. It is *not* a qualified
electronic signature under eIDAS. Do not claim in the UI or the docs that it is.
High-stakes contracts keep going through a provider.

## 9. No invoicing, no payments, ever

Bureau reminds you to invoice and tracks what is owed. It does not generate,
number, or send invoices, and it never moves money. Invoicing carries legal
requirements that vary by country and change; a reminder that points at the real
accounting tool carries none of them.

This is a scope boundary, not a missing feature. Keep it.

## 10. Fonts are bundled, not fetched

Inter and JetBrains Mono ship inside the app. A `<link>` to Google Fonts is a
network dependency in an application whose whole promise is that it works
offline, and it leaks a request to a third party on every launch.

## 11. Calendar is local, with import before sync

Own tables, `rrule` for recurrence, `ical.js` for `.ics` import and export.
CalDAV is a later, additive phase. A local calendar tied to project deadlines is
useful long before two-way sync is.

## 12. `.claude/` is committed

Unlike the client website kit, where it is gitignored to keep an AI out of a
client's repo, here the rules are part of the project and worth versioning.

The **no AI attribution in git history** rule still applies. See
[../.claude/rules/git.md](../.claude/rules/git.md). Commits should read as though a
developer wrote them, because the decisions in them are the developer's.

## 13. Licence: undecided, and deliberately so

The repo starts private with no `LICENSE` file, which means default copyright,
meaning all rights reserved. That is the right default while the answer is unknown,
because adding a permissive licence later is easy and retracting one is not.

Decide before the repo goes public. The question to answer first is whether a
company should be able to take Bureau, host it, and sell it back.

## 14. Theme is a three-state setting, not a toggle

`system`, `light`, `dark`, defaulting to `system`. A two-state toggle cannot
express "follow the OS", which is what most people want most of the time.

The choice is an application setting, not a database row, because it belongs to
the installation rather than to the data. It is applied by setting `data-theme`
on `<html>`, and the main process sets `nativeTheme.themeSource` to the same
value so the title bar, menus and native dialogs match. Setting only one of the
two produces a light title bar over a dark window.

The token cascade in `brand/tokens.css` already handles all three: `:root` is
light, the `prefers-color-scheme` block follows the OS, and an explicit
`data-theme` overrides both. Do not add a second mechanism.

## 15. The lock has three layers, and only one of them is a lock screen

The user chooses how Bureau locks. Be precise about what each choice protects
against, because a lock screen over an unencrypted database is theatre.

| Layer | Protects against | Cost |
| --- | --- | --- |
| **OS account** (always on) | Another person's login on the same machine. Credentials are already in DPAPI or Keychain, tied to the OS user | None, it is the baseline |
| **Lock screen** (optional, default on) | Someone walking up to your unlocked, running laptop | Small |
| **Database encryption** (optional, off by default) | Someone who steals the machine or copies the file | Real, see below |

**The lock screen** blanks the window, drops sensitive state out of the renderer,
pauses mail sync, and requires re-authentication. Triggers: idle timeout, on
sleep or OS lock, on minimise (optional), and manually. It does **not** protect
the file on disk, and the settings screen must say so in one plain sentence.

**Database encryption** uses `better-sqlite3-multiple-ciphers` with SQLCipher,
replacing plain `better-sqlite3`. It is off by default because the trade is real:
the key must be held in memory while unlocked, a forgotten passphrase means the
data is unrecoverable, and there is no reset. Turning it on must state that in
those words and require the passphrase to be entered twice.

**Unlock methods**, in order of how much work they are:

- **Passphrase.** Argon2id, per-install random salt, parameters stored alongside.
- **PIN.** Convenience only. Rate-limited, with a lockout that escalates.
- **Windows Hello / Touch ID.** Touch ID is reachable through
  `systemPreferences.promptTouchID()`. Windows Hello needs a native module, so it
  is the most expensive option and should be last.

**The rule that keeps a PIN from being a hole:** a PIN is never the key-derivation
input for database encryption. The encryption key is random, generated once, and
stored wrapped by `safeStorage`. The PIN or the biometric unwraps it. A four-digit
PIN used directly as a KDF input is brute-forceable offline in seconds, and doing
this correctly costs one extra indirection.

Lock state lives in the main process. A renderer that believes it is locked is a
renderer that can be told it is not.

## 16. Reference data ships seeded, stays editable, and is never hard-deleted

Document types, statuses, labels, reminder presets and email templates all arrive
with sensible defaults on first run, so the app is usable before it is
configured. All of them are editable, and each set can be reset.

Every row in a seeded set carries:

| Column | Why |
| --- | --- |
| `is_system` | It shipped with Bureau, rather than being user-created |
| `hidden_at` | The user "removed" it. See below |
| `sort_order` | The user's ordering, not the shipped one |
| `seed_key` | Stable identifier, so an upgrade can update the right row |
| `customised_at` | Set on first edit. An upgrade must not overwrite an edited row |

**Removing a system row hides it, it does not delete it.** A status that twelve
documents already point at cannot be deleted without either breaking those rows
or silently rewriting history. Hidden means: not offered for new records, still
rendered correctly on the records that already use it. The same applies to a
user-created row once anything references it.

**Reset** is per set ("reset statuses") and also global. It restores system rows
to their shipped values, clears `hidden_at` and `customised_at`, and asks
separately what to do with user-created rows, because deleting someone's own
labels without asking is not a reset, it is data loss.

**Upgrades** carry a `seed_version`. A new version may add rows and may update
rows whose `customised_at` is null. It may never touch an edited row, and it may
never resurrect a hidden one.

## 17. Phase 0 derives the lock secret with scrypt, not Argon2id

Amends decision 15. `crypto.scryptSync` is in the Node standard library, so it
adds no native module, no ABI rebuild and no prebuilt-binary risk to the one
phase that has to boot before anything else can be built on it. scrypt is
memory-hard and is a legitimate choice for this.

The lock screen is layer 2: it stops someone using the running machine. Database
encryption, which is where key derivation actually carries weight, is out of
scope for now and named as such in the plan.

**Revisit when encryption lands.** At that point move to Argon2id via
`@node-rs/argon2`, which is a NAPI binding and therefore does not need rebuilding
against Electron's ABI. Migrate existing hashes by re-deriving on next successful
unlock, and store the algorithm and its parameters next to the hash from the
start so that migration is possible at all.

## 18. Storage is `node:sqlite`, with a shim so Drizzle can drive it

Amends decision 3, which named `better-sqlite3`.

`better-sqlite3` compiles through `node-gyp`. The development machine has Visual
Studio 2026 without the C++ workload and no Windows SDK, so `npm install` fails
at `find VS`. A compiler would also mean rebuilding against Electron's ABI on
every Electron bump, which is already listed as a trap in
[../.claude/rules/verify.md](../.claude/rules/verify.md).

`node:sqlite` is in the Node standard library. It is synchronous, which is the
property decision 3 actually wanted, needs no compilation, has no ABI to
mismatch, and keeps `.node` files out of the packaging problem entirely. It also
means the project builds on a machine with no compiler, which matters if Bureau
is ever handed to another small business owner.

Verified before adopting: Electron 41.10.7 bundles Node 24.18.0 with `node:sqlite`
present and SQLite 3.53.1, and a real query ran inside Electron.

**Drizzle has no `node:sqlite` driver.** A small shim in
`electron/main/db/node-sqlite-shim.cjs` presents the `better-sqlite3` interface
over it, so `drizzle-orm/better-sqlite3` can be used unchanged. Only two things
need translating: `stmt.raw(bool)` becomes `stmt.setReturnArrays(bool)`, and
`db.transaction(fn)` is implemented with `BEGIN` / `COMMIT` / `ROLLBACK`. Both
were verified by inspecting the real method surface inside Electron.

`drizzle-orm/sqlite-proxy` was the supported alternative and was rejected: it
forces an async API and supports transactions poorly, which is a worse trade than
a shim over an interface that has been measured rather than assumed.

**What would reverse this:** `node:sqlite` leaving experimental with a breaking
change, Drizzle shipping a real `node:sqlite` driver (switch to it), or the
project needing SQLCipher (decision 15), which `node:sqlite` cannot do. That last
one is the important one: **turning on database encryption means revisiting this
decision**, and the likely answer then is `@libsql/client`, which ships prebuilt
NAPI binaries and supports encryption without a compiler.

Pin Drizzle's minor version and read its changelog before upgrading, because the
shim depends on how its better-sqlite3 session calls the driver.

## 19. Templates are HTML, rendered to PDF. `.docx` is an export, not the source.

Amends decision 8, which had `docxtemplater` filling the existing `.docx`
contracts and `printToPDF` rendering HTML templates, without saying how a filled
`.docx` was supposed to become the PDF that gets signed.

It cannot, without an external converter. Turning `.docx` into PDF means
LibreOffice, a print service, or a paid API. LibreOffice is a several hundred
megabyte dependency that has to be installed separately and driven by spawning a
process, which breaks the promise that Bureau is one installer that works
offline. There is no pure-JavaScript `.docx` to PDF renderer worth trusting with
a contract's layout.

So the canonical template body is **HTML**, with a small documented placeholder
syntax. The pipeline is one path, entirely inside Electron:

```
template HTML + record data  ->  rendered HTML
rendered HTML  ->  printToPDF  ->  PDF
PDF + signature PNG  ->  pdf-lib  ->  signed PDF with an audit page
```

What this costs: the legal text is edited as HTML rather than in Word. That is a
real loss for a non-technical owner and an acceptable one here, since the person
editing it writes software. Templates are stored in the database and edited in
the app, so a text editor is not required either.

What it buys: one rendering path, no external binary, identical output on every
machine, and page layout that is actually controllable, which Word round-trips
are not.

`.docx` is not gone, it is demoted. Importing one to bootstrap a template body,
and exporting a generated document as `.docx` for a client who asks, are both
reasonable later additions. Neither is on the path to a signed PDF.

**Client data is escaped on the way into the template.** A client called
`<script>` or a note containing HTML must not become markup. The renderer escapes
every substituted value, and a template that genuinely needs markup in a value
has to opt in per field.
