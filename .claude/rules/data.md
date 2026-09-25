# Data rules

The schema, the migrations and the query habits that keep the local SQLite file
trustworthy and syncable later.

---

## 1. SQLite via better-sqlite3, typed with Drizzle

Decision 3 in [../../docs/decisions.md](../../docs/decisions.md). One file, no
server, synchronous API, generated migrations.

- Tables are declared in `electron/main/db/schema.ts`. That file is the schema.
  There is no second source of truth and no hand-written `CREATE TABLE`.
- Types come from the schema: `type Client = typeof clients.$inferSelect;` and
  `typeof clients.$inferInsert` for writes. Never retype a row shape by hand.
- Queries live in `electron/main/services/`. A Drizzle query in a component, an
  IPC handler or an MCP tool is an architecture bug ([architecture.md](architecture.md)).
- `better-sqlite3` is synchronous, so a long query blocks the main process and
  therefore the window. Keep queries indexed and bounded; paginate lists.
- Enable WAL mode and foreign keys once, when the connection opens:
  `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`.

## 2. The five columns every table has

Non-negotiable, from the first migration, on every table including join tables
(decision 4).

| Column | Type | Why |
| --- | --- | --- |
| `id` | text, UUIDv7, primary key | Two machines syncing integer ids is unfixable. v7 is time-sortable, so it indexes and pages well, and it is the tiebreaker whenever two rows share a timestamp |
| `owner_id` | text, not null | Decides who sees what the day a colleague or a sync server exists. Retrofitting it is a rewrite |
| `created_at` | text, UTC ISO-8601, not null | Ordering and audit |
| `updated_at` | text, UTC ISO-8601, not null | Last-write-wins needs it |
| `deleted_at` | text, UTC ISO-8601, nullable | A sync that hard-deletes cannot tell "deleted" from "not yet received" |

**`uuidv7()` carries a counter, and that is load-bearing.** `created_at` has
millisecond resolution, so any burst write (a seed, a sync, an audit trail, two
attachments on one message) produces rows that share a timestamp exactly. With
randomness straight after the 48-bit timestamp, those ids sort at random and
"v7 sorts by time" is true only between milliseconds, not inside one. The
implementation in `db/columns.ts` uses RFC 9562's monotonic counter method so
ids generated in the same millisecond still sort in creation order, and
`db/columns.test.ts` holds it there.

So **order by the timestamp and then by `id`** wherever the order is meaningful.
A query that orders on `created_at` alone is relying on SQLite handing back
rowid order, which it does not promise.

Put them in a shared `baseColumns` object in `schema.ts` and spread it into every
table, so a new table cannot forget one. `created_at` and `updated_at` are set in
the service, not by a DB default, so the value is the same on every platform.

## 3. Migrations are append-only

- Generated with Drizzle Kit, committed to git, and run forward on launch before
  the first window opens.
- **Never edit a migration that has been applied on a real machine.** Add a new
  one. An edited migration means the developer's DB and the user's DB have the
  same version number and different shapes, and nothing will ever tell you.
- One migration per logical schema change, named for what it does.
- Migration order is file order. Two migrations generated on two branches and
  merged will apply in the wrong order or collide on a number. After any merge
  that touches `migrations/`, regenerate rather than hand-merge, and check the
  journal file.
- A migration that drops or renames a column also carries the data move, in the
  same file. A separate "fix the data" step is a step somebody skips.
- Migrations run inside a transaction. If one fails, the app must refuse to open
  rather than run on a half-migrated file.
- **Foreign keys are off while a migration runs, and checked before it commits.**
  A table SQLite cannot alter in place is rebuilt, and a rebuild drops the old
  table, which is an implicit delete of every parent row: with enforcement on it
  fails as soon as a child row points at it, and `defer_foreign_keys` does not
  save it either. `db/migrate.ts` sets `PRAGMA foreign_keys = OFF` outside the
  transaction, where the pragma is not ignored, and runs `PRAGMA
  foreign_key_check` inside it, so a migration that leaves a dangling reference
  throws and rolls back. Never put either pragma in a migration file.
- **Test a rebuild against a database with rows in it.** Running the whole folder
  against an empty database proves nothing about a rebuild: there is nothing to
  carry and no child row to break. Apply everything up to the file before it,
  write the rows that make it hard, then apply the one under test. See
  `db/migrate-projects.test.ts`.

## 4. Time is UTC, everywhere, always

- Stored as UTC ISO-8601 strings (`2026-03-14T09:05:00.000Z`). Not epoch seconds,
  not `datetime('now','localtime')`, not a `Date` serialised by whatever the
  locale does.
- **Local time is a display concern.** Convert at the edge of the renderer, when
  rendering, and nowhere else.
- A date with no time (an invoice-reminder due date, a contract date) is stored as
  a plain `YYYY-MM-DD` string in its own column type, not as midnight UTC. Midnight
  UTC is the previous day in Brussels for half the year.
- Never compare a stored timestamp against a locally constructed one without
  normalising both to UTC first. See the DST trap in [verify.md](verify.md).

## 5. Money is integer cents

Juno does not invoice or move money (decision 9), but it does track amounts
owed and contract values. Those are integers.

```ts
/** An amount in euro cents. Never a float, never a formatted string. */
export type Cents = number;
```

- Column type is integer. `4999` is 49,99 EUR.
- No floats anywhere in the chain. `0.1 + 0.2` is a support ticket.
- A currency column sits next to any amount column, even while everything is EUR.
- Formatting to "49,99 EUR" happens in the renderer, at render time, with the
  `nl-BE` locale. A service returns `Cents`.

## 6. Soft deletes change every query

Adding `deleted_at` is free. Forgetting it in one query is a row that comes back
from the dead in one screen and not another.

- **Every read filters `isNull(table.deletedAt)`** unless it is explicitly a trash
  or audit view. Wrap it: a per-table `alive()` helper in the service beats
  remembering.
- Deleting is `update ... set deleted_at = now, updated_at = now`. `DELETE` is
  reserved for a real purge, which is its own service function, confirmed by the
  user, and never exposed as an unattended MCP tool ([mcp.md](mcp.md)).
- Unique constraints and soft deletes fight each other: a deleted client's email
  still occupies the unique index. Use a partial unique index conditioned on
  `deleted_at IS NULL`.
- Counts, aggregates and "does this exist" checks filter too. Especially those.

## 7. Indexes

- Index every foreign key. SQLite does not do it for you.
- Index the columns you actually sort and filter lists by: `(owner_id, deleted_at,
  created_at)` covers most list screens.
- Mail needs more: `(account_id, folder, internal_date)` for the list, plus a
  unique index on `(account_id, uid_validity, uid)` so a re-sync updates instead of
  duplicating.
- Full-text search on mail and documents uses SQLite FTS5, as a separate virtual
  table kept in sync by the service. Do not bolt `LIKE '%x%'` onto a large table
  and call it search.

## 8. Where the file lives, and the backup story

- The database is a single file at `app.getPath("userData")/juno.db`, plus the
  WAL and shm files next to it. Never in the install directory, never in the repo.
- Attachments and generated documents are files on disk under the same userData
  root, with the DB storing a relative path. Blobs in SQLite make backups slow and
  the file fragile.
- Backup is a copy of the whole folder while the app is closed, or the
  `VACUUM INTO` a service exposes as an explicit export. Copying `juno.db` alone
  while the app is running loses whatever is in the WAL.
- The DB file, the WAL, any `.sqlite` fixture and any real mail account are
  gitignored and never committed ([git.md](git.md)).
- Seed and demo data go through the same service functions as real data. A
  hand-written `INSERT` skips validation and produces rows the app cannot have made.

## 9. Seeded reference data is hidden, never deleted

Decision 16. Document types, statuses, labels, reminder presets and email
templates ship with defaults on first run, stay editable, and can be reset.

They still carry the five mandatory columns from section 2, including
`deleted_at`. These five are **extra**, on top of them:

| Column | Type | Why |
| --- | --- | --- |
| `is_system` | integer boolean, not null | It shipped with Juno rather than being user-created. Decides what a reset restores |
| `hidden_at` | text, UTC ISO-8601, nullable | The user removed it from the pickers. See below |
| `sort_order` | integer, not null | The user's ordering, not the shipped one |
| `seed_key` | text, not null for system rows | Stable identifier, so an upgrade updates the right row after a rename |
| `customised_at` | text, UTC ISO-8601, nullable | Set on first edit. An upgrade must not overwrite an edited row |

**Removing a system row sets `hidden_at`. It does not delete and it does not soft
delete.** A status that twelve documents already point at cannot be removed
without breaking those rows or silently rewriting their history. Hidden means: not
offered when creating or editing a record, still resolved and still rendered
correctly on every record that already uses it. The same applies to a user-created
row the moment anything references it, so check for references before offering a
delete at all.

So reads come in two shapes, and picking the wrong one is the bug this section
exists to prevent:

- **Pickers and creation forms** filter `hidden_at IS NULL` on top of the usual
  `deleted_at IS NULL`, ordered by `sort_order`.
- **Rendering an existing row's value** filters neither. Resolve by id and display
  it, hidden or not.

**Reset** is per set ("reset statuses") and also global. It restores system rows to
their shipped values, clears `hidden_at` and `customised_at`, and asks separately
what to do with user-created rows, because deleting someone's own labels without
asking is data loss wearing the word reset. It runs in one transaction and through
the service, like any other seed (section 8).

**Upgrades** carry a `seed_version` per set. A newer version may add rows and may
update rows whose `customised_at` is null. It may never touch an edited row and it
may never resurrect a hidden one. Bumping `seed_version` without checking those two
conditions is how a user's configuration silently reverts after an update.
