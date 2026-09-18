# Start here

**If you are a session picking this up cold, this is the orientation. Read it,
then read [BUILD-LOG.md](BUILD-LOG.md), then start work.**

Bureau is a working Electron desktop app. Phases 0, 1 and 2 of [PLAN.md](PLAN.md)
are complete. It builds, packages, installs and runs.

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
| **Templates** | The contract texts, editable, with a live preview |
| **Settings** | Theme, lock, reference data, owner details, signature, accounting link, backup |

Not built: mail (phase 3), calendar (phase 5), the MCP server itself (phase 6).
The MCP **tool descriptors** exist for every service already, so phase 6 is
assembly rather than archaeology.

## Read these, in this order

| File | Why |
| --- | --- |
| [BUILD-LOG.md](BUILD-LOG.md) | **Start here.** Where things stand, every deviation from the plan, and every trap found the hard way |
| [TODO.md](TODO.md) | The two things waiting on Nathan, and what unblocks each |
| [PLAN.md](PLAN.md) | The phases, what ships in each, and the test for when one is done |
| [docs/decisions.md](docs/decisions.md) | 19 decisions, each with what would have to change to reopen it |
| [CLAUDE.md](CLAUDE.md) | Loaded automatically. The rules index and the highest-value rules inline |

`BUILD-LOG.md` first, because several things in `PLAN.md` and `decisions.md` have
been amended by what actually happened. The log says which.

## The four things that will bite you

1. **Tests run under Electron's Node, not the host's.** `node:sqlite` before Node
   24 has no `StatementSync.setReturnArrays`, which the storage shim needs, so
   every query throws on an older host Node. `npm run test` handles it.
2. **`npm run smoke` is the only check that proves the app runs.** A clean
   typecheck says nothing about the custom scheme, the preload bridge or the
   database. `BUREAU_SMOKE_DEMO=1 node scripts/smoke.mjs` creates real records
   through the bridge and photographs six screens in both themes into `.smoke/`.
   Several real bugs were found only by looking at those images.
3. **Storage is `node:sqlite` behind a shim**, not `better-sqlite3`, because this
   machine has no C++ compiler. Decision 18. Drizzle is assembled by hand in
   `electron/main/db/index.ts` because its own entry point requires
   `better-sqlite3` at module load.
4. **Calendar dates are `YYYY-MM-DD` strings and the maths is UTC.** Never round
   trip one through a local `Date`. That is how a reminder fires on the wrong day
   twice a year.

## What to do next

**Phase 3, the IMAP mail client**, is next in the plan and is also the phase most
likely to kill the project: 10 to 16 weeks, and long stretches with nothing
visible. It is cut into four sub-ships (3a one account and INBOX, 3b all accounts
and folders, 3c search, 3d client linking) precisely so a stall leaves a working
app rather than a dead repo. If 3a runs past six weeks, stop and reconsider,
including not building it.

Before starting it, the honest move is to install the packaged build and use
phases 0 to 2 on real work for a while. A phase that is not being used is
evidence the next phase is the wrong thing to build.

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
