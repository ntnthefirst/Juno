# Start here

**If you are a session picking this up cold, this is the orientation. Read it,
then read [BUILD-LOG.md](BUILD-LOG.md), then start work.**

Bureau is a working Electron desktop app. Phases 0, 1, 2, 5 and 6 of
[PLAN.md](PLAN.md) are complete, bar phase 6's in-app assistant panel. Phases 3
and 4, reading and sending mail, are built and proven against a fake mailbox and
a fake transport, but neither has met a real server yet. It builds, packages,
installs and runs.

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
| **Mail** | IMAP accounts pulled into SQLite. Threads, a sandboxed reader, search, client linking. An outbox that sends over SMTP behind a confirmation gate, with reply, templates and document attachments |
| **Calendar** | Events and recurring series with an IANA zone each, month, week and agenda views, reminders and project deadlines overlaid, drag to move and resize with the recurrence question asked, .ics in and out |
| **Agent** | An MCP server over a local pipe, 99 tools, every side-effectful one parked for approval. Automations, an audit log, briefings across every domain, and the config block to paste into an agent |
| **Templates** | The contract texts and the mail templates, editable, with a live preview |
| **Settings** | Theme, lock, reference data, owner details, accounting link, mail accounts, signature, backup |

Not built: the in-app assistant panel, the one part of phase 6 that needs a
model and therefore a decision about which one and where its key lives. An
external agent pointed at Settings > Agent drives the same surface today.

## Read these, in this order

| File | Why |
| --- | --- |
| [BUILD-LOG.md](BUILD-LOG.md) | **Start here.** Where things stand, every deviation from the plan, and every trap found the hard way |
| [TODO.md](TODO.md) | The three things waiting on Nathan, and what unblocks each |
| [PLAN.md](PLAN.md) | The phases, what ships in each, and the test for when one is done |
| [docs/decisions.md](docs/decisions.md) | 22 decisions, each with what would have to change to reopen it |
| [CLAUDE.md](CLAUDE.md) | Loaded automatically. The rules index and the highest-value rules inline |

`BUILD-LOG.md` first, because several things in `PLAN.md` and `decisions.md` have
been amended by what actually happened. The log says which.

## The eight things that will bite you

1. **Tests run under Electron's Node, not the host's.** `node:sqlite` before Node
   24 has no `StatementSync.setReturnArrays`, which the storage shim needs, so
   every query throws on an older host Node. `npm run test` handles it.
2. **`npm run smoke` is the only check that proves the app runs.** A clean
   typecheck says nothing about the custom scheme, the preload bridge or the
   database. `BUREAU_SMOKE_DEMO=1 node scripts/smoke.mjs` creates real records
   through the bridge, syncs a mailbox held in memory, sends through a transport
   held in memory, and photographs eight screens in both themes into `.smoke/`.
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
6. **Nothing an agent can call produces a queued message.** The outbox state is
   the gate (decision 22): `mail.send` parks a draft in `pending`, and `approve`
   has an IPC channel and no tool. Adding a tool that queues, or an adapter that
   says `actor: "user"` for anything but the window, is the one change that
   would make the rule in `.claude/rules/mcp.md` section 4 false.
7. **A calendar event is a wall clock plus a zone, never an instant.**
   `start_local` is `2026-09-22T10:00:00` and `timezone` is `Europe/Brussels`;
   `start_utc` exists only so a range query can be indexed. A series is
   expanded on the wall-clock values and each occurrence converted afterwards
   (decision 23). Expanding from the UTC column is the bug that puts every
   occurrence after the October change an hour off, and the test in
   `calendar-recurrence.test.ts` named after that change is the one to keep.
8. **An agent's call does not run when it is made.** Anything side-effectful
   parks in `agent_actions` and returns a pending envelope; a person approves
   it under Agent and only then does the handler run (decision 24). `approve`
   has an IPC channel and no tool, like the outbox's. If you add a tool, the
   host test in `electron/main/mcp/host.test.ts` will tell you whether its
   flags match what the rules require, and it is meant to fail when they do
   not.

## What to do next

**Run mail against a real account, both ways.** Phases 3 and 4 exist end to
end and every piece of them is tested against a mailbox and a transport held in
memory, which are exactly the kind of servers that never disagree with the RFCs.
Add one of the real accounts under Settings with its SMTP server, sync it, send
one message to yourself, and read the two session entries in
[BUILD-LOG.md](BUILD-LOG.md) for the open questions those runs are meant to
answer. Expect the first real inbox and the first real send to find something
the fakes could not.

The sync is read-only by construction: `MailboxSource` in
`electron/main/services/mail-source.ts` has no method that writes. The one IMAP
write, the copy into Sent, lives on a separate appender in `mail-transport.ts`.
Keep them apart.

**Then point an agent at Bureau.** Settings is not where it lives: open Agent,
copy the configuration, and paste it into Claude Desktop or Claude Code. Ask it
what needs attention this month, and then ask it to create something so a
request appears on the Requests tab. That is phase 6's done-when, and no MCP
client other than the one in the smoke run has connected yet.

**Then open the calendar's export in another calendar.** Phase 5's done-when
in PLAN.md ends with the moved occurrence sitting on the right hour after the
October change when the file is opened elsewhere. The round trip is tested
against Bureau's own reader; Google, Apple and Outlook have not read one of
these files yet.

After that, the honest move is to install the packaged build and use it on real
work for a while before building anything else. A phase that is not being
used is evidence the next one is the wrong thing to build.

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
