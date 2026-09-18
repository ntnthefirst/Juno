# Start here

**If you are a session picking this up cold, this is the orientation. Read it,
then read [BUILD-LOG.md](BUILD-LOG.md), then start work.**

Bureau is a working Electron desktop app. Phases 0, 1 and 2 of [PLAN.md](PLAN.md)
are complete and phase 3, the mail client, is built and proven against a fake
mailbox but not yet against a real account. It builds, packages, installs and
runs.

```bash
npm install
npm run dev
```

---

## What is built

| | |
| --- | --- |
| **Today** | What needs attention, suggestions worked out from the records, a counts line |
| **Reminders** | Grouped by bucket, recurring, snooze and complete, one daily notification |
| **Clients** | Clients, contacts and projects, with search and undo |
| **Documents** | Generated from templates, rendered to PDF, signed with an audit page |
| **Mail** | IMAP accounts pulled into SQLite, read-only. Threads, a sandboxed reader, search, client linking |
| **Templates** | The contract texts, editable, with a live preview |
| **Settings** | Theme, lock, reference data, owner details, accounting link, mail accounts, signature, backup |

Not built: mail sending (phase 4), calendar (phase 5), the MCP server itself
(phase 6).
The MCP **tool descriptors** exist for every service already, so phase 6 is
assembly rather than archaeology.

## Read these, in this order

| File | Why |
| --- | --- |
| [BUILD-LOG.md](BUILD-LOG.md) | **Start here.** Where things stand, every deviation from the plan, and every trap found the hard way |
| [TODO.md](TODO.md) | The three things waiting on Nathan, and what unblocks each |
| [PLAN.md](PLAN.md) | The phases, what ships in each, and the test for when one is done |
| [docs/decisions.md](docs/decisions.md) | 21 decisions, each with what would have to change to reopen it |
| [CLAUDE.md](CLAUDE.md) | Loaded automatically. The rules index and the highest-value rules inline |

`BUILD-LOG.md` first, because several things in `PLAN.md` and `decisions.md` have
been amended by what actually happened. The log says which.

## The five things that will bite you

1. **Tests run under Electron's Node, not the host's.** `node:sqlite` before Node
   24 has no `StatementSync.setReturnArrays`, which the storage shim needs, so
   every query throws on an older host Node. `npm run test` handles it.
2. **`npm run smoke` is the only check that proves the app runs.** A clean
   typecheck says nothing about the custom scheme, the preload bridge or the
   database. `BUREAU_SMOKE_DEMO=1 node scripts/smoke.mjs` creates real records
   through the bridge, syncs a mailbox held in memory, and photographs seven
   screens in both themes into `.smoke/`.
   Several real bugs were found only by looking at those images.
3. **Storage is `node:sqlite` behind a shim**, not `better-sqlite3`, because this
   machine has no C++ compiler. Decision 18. Drizzle is assembled by hand in
   `electron/main/db/index.ts` because its own entry point requires
   `better-sqlite3` at module load.
4. **Calendar dates are `YYYY-MM-DD` strings and the maths is UTC.** Never round
   trip one through a local `Date`. That is how a reminder fires on the wrong day
   twice a year.
5. **A message body is never a string in the renderer.** It is served over
   `app://mail/message/<id>` with its own policy into a frame with an empty
   sandbox, and the window's CSP handler must leave those responses alone
   (decision 20). Widening either policy to make something work is the wrong fix.

## What to do next

**Run the mail client against a real account.** Phase 3 exists end to end and
every piece of it is tested against a mailbox held in memory, which is exactly
the kind of server that never disagrees with the RFCs. Add one of the real
accounts under Settings, sync it, and read the session entry in
[BUILD-LOG.md](BUILD-LOG.md) for the open questions that run is meant to
answer. Expect the first real inbox to find something the fake could not.

The sync is read-only by construction: `MailboxSource` in
`electron/main/services/mail-source.ts` has no method that writes, so a bug
cannot become a lost message. Keep it that way until phase 4.

After that, the honest move is still to install the packaged build and use
phases 0 to 3 on real work for a while before starting phase 4. A phase that is
not being used is evidence the next phase is the wrong thing to build.

## The two open decisions

Neither blocks any code, and both get more expensive the longer they wait. Both
are in [TODO.md](TODO.md) with the detail.

- **The repository.** None exists online yet, which is why `electron-builder.yml`
  has no `publish` block and auto-update is off. An installed build pointing at
  the wrong feed is worse than one that never checks.
- **The licence.** All rights reserved by default, which is the right holding
  position. The question that settles it: should a company be able to take
  Bureau, host it, and sell it back?

## The rules, when writing code

`CLAUDE.md` loads automatically and indexes `.claude/rules/`. Two worth knowing
before touching anything:

**The services layer is the API.** Every capability is written once in
`electron/main/services/`. The IPC bridge and the MCP adapters are thin and hold
no logic. A feature an agent cannot drive is not finished.

**Five columns on every table**, from the first migration: UUIDv7 `id`,
`owner_id`, `created_at`, `updated_at`, `deleted_at`. Adding them costs an hour.
Retrofitting them costs a rewrite.

## Working with skills

| You want | Say |
| --- | --- |
| A whole new domain | `/feature-new mail` |
| A new screen | `/screen-new` |
| An existing service exposed to the agent | `/mcp-tool-new` |
| A schema change | `/migration-new` |
| A contract or email template | `/template-new` |
| Commits for finished work | `/commit-work` |
| Pre-release check | `/ship-check` |
