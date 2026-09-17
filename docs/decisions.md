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
- Writing a feature twice — once for the UI, once for the agent — is a bug.

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
electronic signature under eIDAS — do not claim in the UI or the docs that it is.
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

The **no AI attribution in git history** rule still applies — see
[../.claude/rules/git.md](../.claude/rules/git.md). Commits should read as though a
developer wrote them, because the decisions in them are the developer's.

## 13. Licence: undecided, and deliberately so

The repo starts private with no `LICENSE` file, which means default copyright —
all rights reserved. That is the right default while the answer is unknown,
because adding a permissive licence later is easy and retracting one is not.

Decide before the repo goes public. The question to answer first is whether a
company should be able to take Bureau, host it, and sell it back.
