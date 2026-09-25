# Structure

A map of the repository: what is built, where each piece lives, and which file
to open for a given change. Read this and [TODO.md](TODO.md) before starting
work.

Juno is a working Electron desktop app. It builds, packages, installs and runs.

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
| **Clients** | Clients, contacts and projects, with search and undo. A record opens on a card, with tabs and a timeline of everything that has happened with it |
| **Projects** | A piece of work with its links, its files, the folder it is checked out into and the command that starts it. Cards, rows or a dense list. A project need not belong to a client |
| **Documents** | Generated from a template or imported as a PDF, written to disk at generation, signed with an audit page |
| **Mail** | IMAP accounts pulled into SQLite. Threads, a sandboxed reader, search, client linking. Filing that reaches the server, and an outbox that sends over SMTP behind a confirmation gate |
| **Calendar** | Events and recurring series with an IANA zone each, month, week and agenda views, drag to move and resize, .ics in and out |
| **Agent** | An MCP server over a local pipe, every side-effectful tool parked for approval. Automations, an audit log, briefings across every domain |
| **Templates** | Mail templates laid out on a canvas of sections and blocks, compiled to the HTML a message is made of, with an editable code view back into it. Document templates edited as pages, compiled to the HTML the PDF pipeline takes |
| **Settings** | Theme, lock, reference data, owner profile, accounting link, mail accounts, signature, backup |

**Not built:** the in-app assistant panel, which needs a decision about which
model and where its key lives. An external agent pointed at the Agent screen
drives the same surface today.

**Built but not yet met a real server:** reading and sending mail. Both are
proven against a mailbox and a transport held in memory, which are exactly the
kind of servers that never disagree with the RFCs. Expect the first real
account to find something the fakes could not.

## The shape

Four layers, one job each. This is the rule the rest of the project is built
on, and [.claude/rules/architecture.md](.claude/rules/architecture.md) is the
long version.

| Layer | Lives in | Job |
| --- | --- | --- |
| Renderer | `src/` | React screens and view state. Never touches SQLite, `fs` or IMAP |
| Preload | `electron/preload.ts` | A fixed list of named channels, no logic |
| Adapters | `electron/main/ipc/`, `electron/main/mcp/` | Unwrap arguments, call one service, return the result |
| Services | `electron/main/services/` | Every capability, implemented exactly once |

**The services layer is the API.** A capability is written once and both the
window and an agent get it. A feature an agent cannot drive is not finished,
and writing one twice is a bug in the design.

## Repository layout

```
STRUCTURE.md            This file
TODO.md                 What is deliberately not done, and what unblocks each
CLAUDE.md               Loaded automatically. The rules index, key rules inline
docs/
  decisions.md          Locked technical decisions and the reason for each
  editors.md            How the template editors are specified
  templates.md          The document and mail template formats
brand/
  BRAND.md              Name, values, voice, colour and logo rules
  tokens.css            The design tokens. The source of truth for every value
  preview.html          The kit rendered in both themes. Open it in a browser
  logo/                 Mark, wordmark, application icon, favicon
.claude/
  rules/                How to write code here, one file per topic (8 files)
  skills/               Step-by-step workflows for recurring tasks (7 skills)
electron/
  main.ts               Entry point. The boot order is commented and matters
  preload.ts            The contextBridge surface, and the whole of it
  main/db/              Schema, 13 migrations, the node:sqlite shim
  main/services/        All business logic. The API
  main/ipc/             Thin adapters over services, behind the lock guard
  main/mcp/             Thin adapters over the same services, for agents
  main/windows/         Main, settings, setup, splash, and the shared chrome
  main/vault.ts         safeStorage read and write, keyed by account id
  shared/               The contract both processes typecheck against
src/
  app/                  Shell, sidebar, title bar
  features/             One folder per screen (11 of them)
  components/           Dialog, FormPage, SidePanel, Button, Field, Toast
  lib/                  Renderer-only helpers and the typed bridge client
  styles/tokens.css     Copied from brand/tokens.css
scripts/                dev, build, smoke, the MCP bridge, icon generation
```

## Where to make a change

| You want to change | Open |
| --- | --- |
| A business rule | `electron/main/services/<domain>.ts`, and nowhere else |
| The database shape | `electron/main/db/schema/`, then `npm run db:generate` |
| What an agent can do | `electron/main/mcp/<domain>.ts`, one declaration per tool |
| What the window can call | `electron/main/ipc/<domain>.ts` and `electron/preload.ts` |
| A screen | `src/features/<domain>/` |
| Something two screens share | `src/components/` |
| A colour, a size, a radius | `brand/tokens.css`, then copy to `src/styles/tokens.css` |
| Window behaviour | `electron/main/windows/` |

## The structural facts that will bite you

1. **Storage is `node:sqlite` behind a shim**, not `better-sqlite3`, because
   this machine has no C++ compiler (decision 18). Drizzle is assembled by hand
   in `electron/main/db/index.ts` because its own entry point requires
   `better-sqlite3` at module load. If a Drizzle upgrade breaks, the fix is
   that one file.
2. **Tests run under Electron's Node, not the host's.** `node:sqlite` before
   Node 24 has no `StatementSync.setReturnArrays`, which the shim needs, so
   every query throws on an older host Node. `npm run test` handles it.
3. **`npm run smoke` is the only check that proves the app runs.** A clean
   typecheck says nothing about the custom scheme, the preload bridge or the
   database. `JUNO_SMOKE_DEMO=1 npm run smoke` walks every screen and every
   settings tab in both themes and photographs each into `.smoke/`. Several
   real bugs were found only by looking at those images. Read the line at the
   end that counts identical images before trusting any of them.
4. **Calendar dates are `YYYY-MM-DD` strings and the maths is UTC.** Never
   round trip one through a local `Date`. That is how a reminder fires on the
   wrong day twice a year.
5. **A calendar event is a wall clock plus a zone, never an instant.**
   `start_local` is `2026-09-22T10:00:00` and `timezone` is `Europe/Brussels`;
   `start_utc` exists only so a range query can be indexed. A series is
   expanded on the wall-clock values and each occurrence converted afterwards
   (decision 23). The test named after the October change is the one to keep.
6. **A message body is never a string in the renderer.** It is served over
   `app://mail/message/<id>` with its own policy, into a frame with an empty
   sandbox, and the window's CSP handler must leave those responses alone
   (decision 20). Widening either policy to make something work is the wrong
   fix.
7. **Nothing an agent can call produces a queued message.** The outbox state is
   the gate (decision 22): `mail.send` parks a draft in `pending`, and approve
   has an IPC channel and no tool. Adding a tool that queues is the one change
   that would make [.claude/rules/mcp.md](.claude/rules/mcp.md) section 4 false.
8. **An agent's call does not run when it is made.** Anything side-effectful
   parks in `agent_actions` and returns a pending envelope; a person approves
   it under Agent and only then does the handler run (decision 24). The host
   test in `electron/main/mcp/host.test.ts` checks a new tool's flags against
   what the rules require, and is meant to fail when they do not match.
9. **Sync cannot write, and the type it is handed enforces that.**
   `MailboxSource` has no method that writes. Filing goes through
   `MailboxWriter` in `mail-writer.ts`, and the Sent copy through a third
   interface again. Every filing call changes the server first and the local
   rows second, so a server that cannot be reached fails the whole call with
   nothing changed here.
10. **A mail template canvas compiles to flexbox and grid, and Outlook cannot
    render either.** Outlook on Windows uses Word's engine, so it stacks every
    section into one column and drops the gaps and the alignment. That was
    chosen over compiling to nested tables, and the section inspector states
    it where the choice is made. Nothing in the model is positioned: custom
    CSS is allowed and `sanitiseDeclarations` strips the positioning
    properties out of it, so the escape hatch cannot reintroduce what the
    model refuses. `layout_json` is null for every template written before the
    canvas, and those stay on the HTML editor until somebody converts one.
11. **A project's command has no MCP tool, and adding one would be the
    mistake.** It runs in a real shell with the owner's privileges, so a tool
    that writes one plus a tool that runs one is a remote shell with an
    approval dialog in front of it (decision 35). `projects.list_commands` is
    read-only and is the only command tool there is.

## The first run

An empty install is met by a small modal window in front of the application,
the same shape as settings and smaller (decision 34): welcome, name, business,
appearance, the lock, mail, done. It cannot be skipped as a whole, and closing
the window quits Juno. The two answers it insists on are the owner's name and
the business name, because every generated document carries both. A walkthrough
over the real app follows, and both can be replayed from Settings > General.

There is one modal child at a time. Opening setup closes settings and the other
way round, and when either closes the main process sends `window.childClosed`.

`onboarding` lives in `settings.json`, not the database, so replacing the
database does not replay setup and `npm run dev:clean` does.

## Before saying something works

`npm run check` is lint, typecheck and test together. `npm run smoke` is
required for anything touching the main process, the preload bridge, the
schema or the windows. Anything visual gets looked at in both themes. The
traps and the full definition of done are in
[.claude/rules/verify.md](.claude/rules/verify.md).
