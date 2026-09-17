---
name: migration-new
description: Change the Bureau database schema - a new table, a new column, an index, a rename, a backfill. Generates the Drizzle migration, checks the five mandatory columns, plans the backfill, and verifies forward on a copy of the real database with a backup taken first. Use when the user says "add a field to clients", "we need a table for X", "the schema is wrong". Not for a whole new domain end to end - use feature-new, which starts here.
---

# Workflow: a schema change

**Follow [CLAUDE.md](../../../CLAUDE.md) and [.claude/rules/](../../rules/)
throughout, [data.md](../../rules/data.md) in particular.** This file is the
procedure around a migration: what has to be in it, and how to be sure it runs
on the owner's real data without losing anything.

Two facts shape everything below.
[decisions.md](../../../docs/decisions.md), 3 and 5: migrations run forward on
launch, and the SQLite file is the source of truth. There is no server copy to
restore from. **A bad migration on the live database is data loss.**

---

## Step 1 — Read the current schema first

```bash
ls db/migrations
grep -rn "sqliteTable" db/schema
grep -rn "<table>" db/schema electron/main/services
```

Establish: does the table exist, what already references it, and which service
functions read the column you are about to change. A migration that lands ahead
of the service change breaks the app at launch.

**Never edit a migration that has already been applied on a real machine**, not
to fix a typo, not to "clean it up". The file is history. Add a new one.

## Step 2 — Update the schema file

Edit `db/schema/<domain>.ts`. Every new table carries the five mandatory columns
from its first migration, no exceptions:

- [ ] `id` text primary key, **UUIDv7**, never autoincrement.
- [ ] `owner_id` text not null.
- [ ] `created_at` text not null, UTC ISO-8601.
- [ ] `updated_at` text not null, UTC ISO-8601.
- [ ] `deleted_at` text nullable, UTC ISO-8601.

And the rest:

- Foreign keys reference `id`, and are declared, not implied by a naming
  convention.
- Timestamps are UTC ISO-8601 text. Never a local time, never a Unix integer.
- Index what the service filters and sorts on: `owner_id`, `deleted_at`, the
  foreign keys, and any column a list screen orders by.
- A column that is conceptually required on a **new** table is `not null` there.
  On an **existing** table it arrives nullable, gets backfilled, and only then
  becomes `not null` in a later migration. SQLite cannot add a `not null` column
  without a default, and a default you picked to satisfy the engine is a lie in
  every existing row.

## Step 3 — Generate the migration

```bash
npm run db:generate
```

**Read the generated SQL before running anything.** Drizzle is good, not
clairvoyant. Check specifically:

- [ ] No `DROP TABLE` or `DROP COLUMN` you did not intend. SQLite's table rebuild
      strategy can turn a rename into a drop and recreate.
- [ ] A rename is a rename, not a drop plus an add. If it isn't, write the
      `ALTER TABLE ... RENAME COLUMN` by hand.
- [ ] Indexes you asked for are there.
- [ ] Nothing touches a table this change has no business in.

Rename the file to something readable if the generator's name is a timestamp
salad, but only before it has ever been applied.

## Step 4 — Plan the backfill

A new column on a table with rows in it needs an answer to "what goes in the
existing rows", and the answer is never "whatever the default is" unless the
default is genuinely correct for every historical row.

- **Derivable** from other columns: backfill in the same migration, with an
  `UPDATE` that shows the derivation.
- **Unknown, and the code can handle it**: leave it null and make the service
  handle null. Document what null means in the schema file.
- **Unknown, and the code cannot handle it**: the column stays nullable, the
  screen shows the rows that need filling, and the owner fills them. Then a
  later migration makes it `not null`. Do not invent values to satisfy a
  constraint.

Backfill runs **inside the migration**, in the same transaction as the schema
change. A backfill script run separately afterwards is a database that was wrong
in between.

A data-only migration (no schema change, only an `UPDATE`) is still a migration
file. It is not something run by hand once on the owner's machine.

## Step 5 — Verify forward from empty

```bash
rm -f .tmp/verify.db
npm run db:migrate -- --db .tmp/verify.db
npm run typecheck
npm run test
```

Every migration in the folder, in order, on an empty file, with no errors. This
is what a fresh install does, and it is the check people skip.

Then verify on **real-shaped data**, against a copy, never the original:

```bash
cp "<userData>/bureau.db" ".tmp/bureau-copy.db"
npm run db:migrate -- --db .tmp/bureau-copy.db
```

- [ ] Row counts before and after match on every table you did not intend to
      change.
- [ ] Spot-check five real rows for the new column and the backfill.
- [ ] Soft-deleted rows survived. A migration that quietly hard-deletes
      `deleted_at is not null` rows breaks the whole sync premise.
- [ ] The app boots against the copy and the affected screen renders.

## Step 6 — Back up before the live run

Before the migration ever runs on the owner's real database:

```bash
cp "<userData>/bureau.db" "<userData>/bureau.db.bak-<yyyy-mm-dd-hhmm>"
```

- Take it with the app **closed**. A copy taken mid-write is a copy of a
  half-written database.
- Keep the WAL and SHM files with it if they exist, or checkpoint first.
- Say out loud, in the chat, where the backup is and how to put it back:
  close the app, replace the file, relaunch.
- The backup file lives outside the repo, and is never committed
  ([git.md](../../rules/git.md)).

Only then launch the app and let it migrate forward.

## Step 7 — Commit

Per [git.md](../../rules/git.md). The schema file, the migration and the service
change that needs it go together. A migration committed without the code that
uses it is a commit that leaves the app at a schema the code doesn't know.

```bash
git add db/schema/clients.ts db/migrations/0007_add_client_vat_number.sql electron/main/services/clients.ts
git commit -m "Add VAT number to clients"
```

**Never commit the database file, a `.bak`, a WAL or an SHM file.** Check:

```bash
git status --short
git ls-files | grep -iE "\.db$|\.db-wal|\.db-shm|\.bak"
```

Both must come back clean. Plain human subject, no AI attribution.

## What this skill does

- Reads the existing schema and callers before changing anything.
- Enforces the five mandatory columns, UUIDv7 ids, UTC timestamps and soft
  deletes.
- Reads generated SQL for accidental drops and fake renames.
- Plans the backfill in the same transaction, or leaves the column nullable
  honestly.
- Verifies forward from empty and on a copy of the real database, with a backup
  taken first.

## What this skill does NOT do

- It doesn't edit a migration that has already been applied.
- It doesn't run anything against the owner's live database without a backup.
- It doesn't invent values to satisfy a `not null` constraint.
- It doesn't hard-delete rows, or drop a column just because nothing reads it
  today.
- It doesn't commit database files, backups or WAL files.
