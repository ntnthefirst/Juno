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

Juno reminds you to invoice and tracks what is owed. It does not generate,
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
company should be able to take Juno, host it, and sell it back.

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

The user chooses how Juno locks. Be precise about what each choice protects
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
| `is_system` | It shipped with Juno, rather than being user-created |
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
means the project builds on a machine with no compiler, which matters if Juno
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
process, which breaks the promise that Juno is one installer that works
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

## 20. Mail bodies are sanitised with sanitize-html and shown from their own origin

`.claude/rules/security.md` asks for a maintained sanitiser and names DOMPurify
as the obvious choice. DOMPurify needs a DOM, which in the main process means
jsdom, a large dependency whose only job here would be to host the sanitiser.
`sanitize-html` parses with htmlparser2, needs no DOM, and is configured by
allow-list. It is used with `parseStyleAttributes` off and the style
declarations inspected by hand, because postcss rejects the odd but harmless
markup mail clients produce.

The sanitised body is not handed to the renderer as a string. It is served as a
complete document over `app://mail/message/<id>` with its own
Content-Security-Policy header (`default-src 'none'`, inline styles, `data:`
images, and `https:` images only when the person asked for them on that one
message), and the reader shows it in a frame with an empty `sandbox`. The main
window's policy allows `frame-src app://mail` and nothing else. So a body is
four layers away from the application: the sanitiser, the frame's own origin,
the frame's own policy, and the sandbox. Links inside the body do not navigate;
their targets are listed under the frame and opened through the shell after a
protocol check.

One consequence: the main window's `onHeadersReceived` must not stamp the
application policy onto `app://mail` responses, because that policy carries
`frame-ancestors 'none'` and would block the frame. The smoke run found this.

**What would reverse this:** sanitize-html going unmaintained (switch to
DOMPurify over a lightweight DOM), or Electron gaining a way to give a frame its
own policy without a second origin.

## 21. Mail search is FTS5, kept in sync by triggers, in the migration

`data.md` section 7 says full-text search is a separate FTS5 virtual table kept
in sync by the service. The table exists (`mail_messages_fts`), but it is kept
in sync by three triggers on `mail_messages` rather than by service code,
because a service that forgets to update the index in one code path produces a
message that exists and cannot be found, and nothing tells you. Triggers cannot
forget.

Drizzle cannot declare a virtual table or a trigger, so both are appended by
hand to the generated migration, `0003_mail.sql`, after the generated part. A
future `drizzle-kit generate` does not know about them and will not drop them,
because it diffs schema snapshots, not the database.

The FTS table is standalone rather than an external-content table over
`mail_messages`, because external content needs a stable integer rowid and a
table with a text primary key can have its implicit rowids renumbered by
`VACUUM`. The cost is that subject, text body and sender are stored twice. The
HTML body is not indexed at all.

Ranking has a shape SQLite insists on: `bm25()` and `snippet()` only work in
the query that runs the MATCH, and the planner flattens a plain subquery into
the surrounding join, which breaks that. The ranking lives in a `materialized`
CTE for that reason, and `mail-threads.ts` says so.

## 22. Sending is a queue with a gate, and the gate is a state

Phase 4 sends mail, and `mcp.md` section 4 says a tool that sends requires a
person's explicit confirmation, enforced in the service, never in the adapter.
That rule became a table rather than a flag.

`mail_outbox` holds every composed message with a state: draft, pending,
queued, sending, sent, failed, cancelled. The sender reads `queued` and nothing
else. A message reaches `queued` through exactly two service functions.
`requestSend(id, { actor })` queues it when the actor is a person and parks it
in `pending` when the actor is an agent; `approve(id)` moves pending to queued.
The IPC adapter says `actor: "user"` because it is only reachable from the
window; the MCP tool says `actor: "agent"`; and `approve` has an IPC channel and
no MCP tool, so nothing an agent can call ever produces a queued row. The actor
is the one thing an adapter states, and it is a fact about the caller rather
than a decision.

Three consequences that follow from the state being the gate:

- A pending message edited by a person becomes that person's draft again, so an
  agent's request cannot be approved with different words than the agent asked
  for.
- A failed message is retried under the same Message-ID, without a second
  approval, because it was approved once and the retry is the same message.
- A template gap (`[ontbreekt: ...]`) is refused at the gate, not at render
  time, so no path from any adapter sends a placeholder to a client.

The message bytes are built once with nodemailer's MailComposer, sent as raw
bytes with an explicit envelope, and those same bytes are appended to the
account's Sent folder. Building twice would produce two messages that differ
in boundaries and dates and look, to a phone, like two messages. The append is
the one IMAP write in the project and lives beside the read-only source
interface rather than on it, so the phase 3 promise stays enforced by the type.

**What would reverse this:** a second sending channel (a queue in a cloud
worker, say) that could not share the SQLite row as its source of truth. Then
the gate would have to move to wherever the queue lives, and decision 5 would be
the first thing to reopen.

## 23. A calendar event is a wall clock in a zone, and exceptions are rows

Phase 5 stores `start_local` and `end_local` as `YYYY-MM-DDTHH:MM:SS` with no
zone suffix, beside an IANA `timezone`, and keeps `start_utc`, `end_utc` and
`series_end_utc` only as an index for range queries. PLAN.md section 3 had
sketched `starts_at` and `ends_at` as instants with a zone beside them; that
shape is wrong for the one case the phase exists for. "10:00 every Tuesday in
Brussels" is at 08:00Z until the clocks change and 09:00Z after, so a rule
expanded from an instant lands every later occurrence an hour off. Expansion
therefore runs in floating time, on the wall-clock values, and each occurrence
is converted to an instant with the event's zone afterwards. `Intl` does the
conversion; there is no zone table to bundle and no native module.

Exceptions live in `calendar_event_exceptions`, keyed by the wall-clock start
the rule produced, rather than in an `exdates` column and self-referencing
override rows. One row per changed occurrence carries `cancelled` or the
fields that differ, which is exactly what `EXDATE` and `RECURRENCE-ID` say in
a file, so import and export are a mapping rather than a translation. Editing a
series is three shapes and only three: `this` writes an exception, `following`
splits the series (UNTIL on the old master, a fresh master from the split with
the exceptions carried across), `all` changes the master and shifts the
exception keys by the same delta. The question is asked in the interface and
answered in the arguments; the service never guesses.

`rrule` expands rules and `ical.js` reads and writes files, per decision 11.
`rrule`'s own `tzid` option is not used: it depends on an optional library and
misbehaves at the boundaries this decision exists to get right. Exported timed
events carry a VTIMEZONE built from what `Intl` reports for the zone, sampled
over the year and reduced to the yearly rule the transitions follow, so a
reader without its own zone table still lands occurrences on the right hour.

**What would reverse this:** a sync target that owns the recurrence model
(CalDAV expands on the server; Google's API returns instances). Then Juno's
expansion becomes a cache of the server's and the exception rows become the
server's overrides, and the file boundary in `calendar-ics.ts` becomes the sync
boundary instead.

## 24. The agent reaches Juno through a bridge, and the gate is a table

The MCP server could not be the app. The database is open in the main process
and only there, the app takes a single-instance lock, and two processes on one
SQLite file is the corruption this project has avoided since decision 3. An
MCP client also insists on spawning its server itself and talking to it over
stdio, which a long-running window cannot provide.

So `scripts/mcp-bridge.mjs` is the server an agent starts: a plain Node script
with no database handle and no logic, which speaks MCP on stdio and forwards
every call to the running app over a named pipe on Windows or a socket file
elsewhere. `electron/main/mcp/socket.ts` listens, `host.ts` routes, and the
per-domain files declare the tools they always did. The wire is
newline-delimited JSON, one connection per call, because both ends ship
together and an agent makes a handful of calls a minute.

Nothing listens on a network port. `mcp.json` in userData carries the address
and a random token, and a connection without it is dropped. Be honest about
what that buys: it stops something that guessed the address, not a program
already running as this user, which can read the file, and could read
`juno.sqlite` directly anyway. The lock is the control that matters, and
every call checks it before anything else.

**The confirmation gate from `.claude/rules/mcp.md` section 4 is the
`agent_actions` table.** A side-effectful tool call does not execute: it parks
with its arguments rendered for a person, and the caller gets back a pending
action rather than a result. Approving runs the handler; rejecting, expiring
or ignoring it does not. `approve` has an IPC channel and no MCP tool, for the
same reason there is no `app.unlock`: the thing being gated is what would call
it. This is decision 22's shape generalised, and `mail.send` keeps its own gate
rather than being wrapped in this one, because the outbox shows a person the
real message instead of an argument list. A tool says so in its declaration
with `gatedInService`, so the exception is visible in the same place as the
rest.

An automation is a stored list of those same calls. It has no interpreter: a
step is a tool name and an argument object, replayed through the same host, so
a step needing approval stops the run and waits for a person, on a schedule as
much as by hand. That is what keeps "an agent may prepare a send and may never
fire it" true when the caller is a timer.

`@modelcontextprotocol/sdk` is used in the bridge only, as PLAN.md chose. It
costs about 19 MB in the installer through dependencies the stdio path never
loads (express, hono, jose and the rest are pulled in by other transports).
Hand-rolling the protocol would save that and take on being wrong about a
protocol that is still moving.

**What would reverse this:** an MCP client that can connect to something
already running, over a local transport that is not stdio. Then the bridge
disappears and `socket.ts` becomes the server itself. Nothing else about the
shape would change, which is why the bridge holds no logic.

## 25. The product is called Juno, and the palette is iris on porcelain

Juno Moneta was the aspect of the goddess who warned, and whose temple on the
Capitoline housed Rome's mint. It is where the word "money" comes from. A back
office that watches the books and warns you in time is the same job, which is
the whole reason the name was chosen over a word that merely described the
software.

The rename is complete rather than cosmetic: `appId`, `productName`, the
`window.juno` bridge, the `JUNO_*` environment variables, the database
filename, the named pipe, the backup prefix and the iCalendar UID domain all
moved together. Leaving any of them on the old name would have produced two
identities for one application, and the one that decides
`app.getPath("userData")` is the one that decides whether a user's data still
exists after an update.

The palette moved with it: cool porcelain surfaces, a deep iris accent, and
brass kept for signed and sealed. The previous warm paper and document-ink blue
were fine and generic. Iris is neither warm nor corporate, it survives the dark
palette without inverting into something else, and it is far enough from every
status colour that a selected row is never mistaken for a successful one.

**What would reverse this:** a trademark conflict on the name, which is the
only reason to pay the cost of moving `userData` a second time.

## 26. Settings is a modal window, not a screen

Settings edits the things every other screen is made of: mail accounts,
reference data, the owner profile, the lock. A settings *screen* lets someone
remove a document status in one tab while another tab is showing twelve
documents that point at it, and both views are right until one of them
refreshes.

So it is a separate window, a modal child of the main one. The operating system
refuses input to the application behind it, which is a stronger guarantee than
any disabled state drawn in the renderer, and it costs one `modal: true`. It is
a fixed size because every section is a single column of fields: there is
nothing a wider window would show.

Both windows load the same bundle and pick their shell from the URL rather than
asking over IPC, so the right one paints on the first frame and a locked
application still knows what it is drawing.

**What would reverse this:** settings growing a view that has to be read
alongside the work, like a live sync log. That is an argument for moving that
one view into the app, not for dissolving the window.

## 27. One main window, and the registry owns that rule

Two windows over one SQLite file means two caches of the same rows and no way
to tell which is stale. `requestSingleInstanceLock` already stopped a second
process; `main/windows/index.ts` stops a second window in the one process, and
is the only file allowed to construct one. A second launch, a dock click and a
tray click all focus what exists.

It also holds the consequences that are easy to miss: the session's
content-policy hook is installed once rather than per window, because a second
registration silently replaces the first; locking closes the settings window,
because it holds mail accounts; and focusing the main window focuses its modal
child instead, because a disabled parent with focus looks like a frozen app.

**What would reverse this:** a genuine second document window, like a message
composed in its own window. That is a new kind of window in the registry, not a
second main window.

## 28. Updates come from public GitHub releases, and never interrupt

The repository is public, so `electron-updater` against its releases needs no
feed to host and no secret beyond the token Actions already provides. A tag
builds installers on Windows and macOS and uploads them to a **draft** release:
publishing that release is the deliberate act that starts a rollout, so a tag
alone can never push a build to every installed copy.

The updater is quiet by design. It checks thirty seconds after launch and daily
after that, it downloads in the background, and it installs on the next quit.
It never checks while Juno is locked, because locked means nobody is at the
keyboard and nothing unattended runs then (decision 15). It is also the only
outbound request Juno makes that the user did not configure themselves, which
is why it lives in one small file that says so.

**What would reverse this:** shipping to clients who cannot reach GitHub, or a
signing certificate arriving with its own distribution channel.

## 29. A splash window, because the first few seconds are honestly slow

Opening the database, running migrations and seeding reference data all happen
before a window can paint anything truthful. On a cold start that is a few
seconds of nothing, and Electron's own answer, a window that exists but has not
painted, is a grey rectangle.

So a small frameless window says the name and the step it is on, and closes on
the main window's `ready-to-show` rather than on its creation. It is built from
a data URL rather than a file because it has to appear before the `app://`
scheme is registered. The progress bar is indeterminate: the work behind it has
no percentage to report, and a fake one that jumps to ninety and waits is worse
than none.

**What would reverse this:** startup getting fast enough that the splash is a
flash, which would make it noise rather than an answer.

## 30. A form is a page, a question is a modal, a row is a side panel

Three shapes, and picking the wrong one is the bug this decision prevents.

**A modal answers a question with two answers.** "Delete these 14 messages?"
is a modal. It is small, it interrupts on purpose, and the only thing to do is
answer it.

**A form is a page** (`components/FormPage.tsx`). It replaces the content and
offers a way back. A modal is narrower than the screen it covers, it traps
focus away from the record being described, and a long form inside one grows a
scrollbar inside a scrollbar. It also cannot show a sequence, which is what
made this decision necessary: adding a mail account is three questions, and
they do not fit in a dialog.

**A row you are still browsing is a side panel** (`components/SidePanel.tsx`),
along the right edge, non-modal. Clicking an appointment used to put a modal
over the month it was clicked in, hiding the context that made it mean
anything and forcing a close before the next one could be opened.

The settings window stays modal, and the difference is worth holding onto:
settings changes the shape of what the rest of the application is showing, so
work behind it has to stop (decision 26). Reading an appointment changes
nothing.

Consequences:

- A screen renders a form page *instead of* its list, not on top of it, so the
  state lives at the screen. Contacts and projects moved up from the client
  detail pane for this reason: that pane is 420px of a split view.
- A form page's submit button sits in the page footer, outside the `<form>`,
  and reaches it with `form={id}`.
- Sections in the settings window own their padding, because a section that
  turns into a form page draws its header and footer against the window edges.

## 31. Server settings are guessed, and the MX record is the second guess

Adding a mail account was fourteen fields, most of which the address already
answers. `services/mail-autoconfig.ts` answers them.

Two steps, deliberately separate:

- `guess(email)` is a table of providers plus the `imap.`/`smtp.` convention.
  No network at all. It covers an address at a provider's own domain.
- `resolveByMx(email)` asks DNS who handles mail for the domain. This is the
  one that gets a business onto the right servers, because a business has its
  own domain and the domain says nothing about who runs its mail. Testing
  against a real account is what found this: `info@digistra.be` fell through
  to `imap.digistra.be`, which does not answer, while the mail lives on
  `imap.mail.ovh.net`.

The lookup is not folded into the guess because it is the only part of adding
an account that leaves the machine. It is offered when the guess had to fall
back, and a person asks for it.

**No autoconfig endpoint is fetched.** A provider's autoconfig URL is a request
to a third party announcing which mail provider this person uses, sent before
they have agreed to anything. A DNS query for a domain's MX is what sending
mail to that domain does anyway.

Nothing a guess produces is saved on its own. It fills the form in, the hosts
stay visible and editable, and the connection test settles it.

## 32. Juno writes itself into agent clients, carefully

Connecting an agent meant copying JSON into a file whose path differs per
client and per platform, and merging it by hand without breaking the servers
already there. `services/agent-install.ts` does it instead, for Claude Desktop,
Claude Code, Cursor, Windsurf and VS Code.

It edits files other programs own, so the rules are strict and they are tested:

- Nothing is written until one client is asked for by name.
- The existing file is copied to `<name>.juno-backup.json` first.
- Only the entry named `juno` is added or replaced. Every other key and every
  other server is read, kept and written back.
- **A file that does not parse is refused, never replaced.** A parse error
  almost always means a format Juno has not seen, and overwriting it would
  destroy somebody's configuration.
- The entry carries the environment a packaged bridge needs. Without it, the
  client starts Juno's window instead of the bridge.

Detection is "does the config file exist", which is as far as honest detection
goes without hunting for executables. A client that has never been opened has
no file and is still offered: writing it is what makes the client find Juno on
first launch.

The agent gets both tools. Listing reads. Connecting files something into
another application, so it waits for a person, like everything else in that
class (.claude/rules/mcp.md section 4).
