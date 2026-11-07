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
| **Overview** | The page Juno opens on. A greeting with one sentence on what is overdue and waiting, four counts (from `briefing.overview`) that open their screens, a "Coming up" agenda of reminders, agent requests, events and deadlines with the day at the left, suggestions worked out from the records (never an invoice), and a right column of unread mail, documents and clients. "Start here" replaces the agenda while Juno is empty. Every block reads for itself and fails on its own |
| **Reminders** | Grouped by bucket, recurring, snooze and complete, one daily notification. Reached from Overview, which keeps its sidebar entry lit |
| **Clients** | Clients, contacts and projects, with search and undo. A record opens on a card, with tabs and a timeline of everything that has happened with it, including a status change made from the button beside the name |
| **Projects** | A piece of work. Cards, rows or a dense list; a project need not belong to a client. A record opens on a header (name, status, client and due date, an Add menu and a "..." menu) over five tabs (`features/projects/`): Notes (live Markdown saved as typed, a Details column, then its documents, links, files and start commands), Mail (the conversations filed under it, linked from a picker or from the reader), Timeline (read back from the records, `services/project-timeline.ts`), Time (entries and one app-wide timer, `services/time-entries.ts`, shown in the title bar by `app/TimerPill.tsx`, decision 56) and Calendar (its dates and reminders). Archive sets an Archived status. The "..." and Add buttons are `components/ActionMenu.tsx`, which opens the same native menus as a right click |
| **Notes** | The seventh place on the rail (decision 61). A list on the left with a search (FTS5, `services/notes.ts`), split by day, pinned notes first, and the open note on the right: a title, "Edited today at 09:12", and lines that are text, bullets or checklists, saved as typed (`features/notes/`, `components/BlockEditor.tsx`). A note may belong to a client or a project, and its right-click menu is native (Pin, Duplicate, Move to a project, Delete). Delete parks like any other when an agent asks |
| **Documents** | A switch between Documents and Templates sits at the top. Generated from a template or imported as a PDF, by picker, by dropping files or from a mail attachment. A document keeps every file it has been as a version, opens as the newest, and recognises an incoming file that is one of its versions by its text. Signed by opening the PDF with the stamp on it, placing it and pressing Sign, or Sign digitally with the owner's own certificate. The signing details go in a `.cert.pdf` beside the signed file, opened from the version list, so the signed PDF gains no page. A page is a document too (decision 62, `services/pages.ts`, `features/documents/PageView.tsx`): blocks of text, headings, checklists and tables written in place, saved as typed, with a slash menu, a format toolbar and Ctrl F. A document is kept under a client, a project, both or nothing (decision 48), and a client's Documents tab and a project's page each list theirs and add one from a template, an import, or a search over the documents that already exist. Opening a document opens its PDF in a viewer, with the details, a version picker and a timeline in a column on the right, and icon buttons to email, download and open it outside. Looking at an older version and then emailing, downloading or signing asks first, in a native dialog |
| **Mail** | New message and Styled mail sit in the title bar; Styled mail opens a column on the right to preview and send templates. IMAP accounts pulled into SQLite. Threads, a sandboxed reader, search, client linking. The composer attaches any document, searched, and any file from this computer by picker or drop; those are sent and not kept unless ticked: a PDF becomes a document, anything else a file of the message's project (decisions 49 and 50). A conversation can be filed under a project from the reader, which lists it on the project and lets its attachments go into the project's files. Filing that reaches the server, and an outbox that sends over SMTP behind a confirmation gate. Each mailbox has rules written by the owner on its account page in settings (`services/mail-rules.ts`, `src/features/settings/mail-account/`, decision 64): tests on the sender, recipients, subject, client and attachments, and actions that mark read, flag, link, move, trash or archive, checked top to bottom on new inbox mail after each sync, once per message, with a history row for every action. Two buttons at the start of the composer toolbar add an intro and an outro (`mail_blocks`, `services/mail-blocks.ts`, `src/features/mail/blocks/`): a rule per block picks one for a new message, the one higher in the list wins, and a right click opens the manage page, which is reached from Mail and returns to the composer. Reading: a link in a message shows its real address in a popover (the frame reports it, `LinkPopover`), Ctrl F finds in the open message (`components/FindBar.tsx`, the frame does the searching), and calendar and project suggestions sit under the header (a project named in the words is offered as a link of the conversation to it; `services/suggestions.ts`, answers in `mail_suggestion_states`, switches in settings.json). Sending an agent's draft yourself closes its request (`agent-actions.closeForSentDraft`). |
| **Calendar** | Events and recurring series with an IANA zone each, month, week and agenda views, drag to move and resize, .ics in and out. Reminders and project deadlines on the grid can be edited, completed, deleted and dragged too. A client or a project lists its own dates and reminders (`ScheduleSection`) and can add them from there |
| **Agent** | An MCP server on a localhost URL that a client is let into with a code, each tool in one of five permission rows (read, change, drafts, send and file, delete) whose level is set under Settings > MCP > Permissions: Off refuses, Ask first parks for approval, Allow runs, and send, sign, file and delete can never be Allow (decision 57, `services/agent-permissions.ts`). The owner's instructions are handed to a client when it connects. Requests, Log and Automations are its three tabs (decision 58). Automations, an audit log purged after six months, briefings across every domain |
| **Templates** | Mail templates laid out on a canvas that is a tree of tagged elements (containers of eight tags that nest, columns tables, text of any tag, pictures, dividers and inputs) in a Figma-shaped editor: layers on the left, a pannable sheet at three reading widths, a design panel on the right with fills, strokes, effects, actions (a link on click, a fill, colour, underline or opacity on hover), typography and linked fonts, Figma's resizing, colour picker and keyboard with undo, breakpoints sent as media queries, a floating toolbar of five groups, each with a menu and a key for every element (the button is a text with a link, in the Text menu), text edited in place, and any element convertible to its own HTML and CSS. A canvas is sent with nothing around it. A first install is given one example laid out on the canvas and no other mail template. Compiled to the HTML a message is made of, with an editable code view back into it. Document templates laid out on the same canvas, on paper of a fixed size (A3 to A6, Letter, Legal, either way round), where each top-level container is a page of the sheet, pictures are files the template keeps, and the preview is the PDF it prints as. Such a template fills in its own inputs and nothing from a record, so using it is fill, see the PDF, then connect a client or save the file. A mail template follows the same rule (decision 47): it is read on a page of its own with Edit and Use above the whole message, and used as Link (recipient, account, client to file it under), Fill, Review. A Word file imports into one, its `{{ }}` fields becoming inputs. Older document templates are still edited as pages or as HTML. A first install is given one example laid out on two pages and no other document template |
| **Shortcuts and search** | One palette (Ctrl or Cmd K) goes to a screen, starts a new record, or finds a client, project, document or conversation by name. Digits go to the seven places, Ctrl or Cmd N starts a new record on the screen in view, Alt Left backs out of a record, Ctrl or Cmd slash shows the sheet. The title bar holds Search, Recent, Reminders and New at the left, the page title in the middle and the agent at the right; the palette is grouped (Go to, Clients, Projects, Mail, Notes, Documents) and has tabs to narrow it, and the lock is a palette command and Ctrl or Cmd Shift L. Pages fill the window, and what arrives is animated (`styling.md` sections 5d to 5f) |
| **Settings** | Theme, lock, reference data, owner profile, accounting link, mail accounts, signature, backup, and a search over all of it (`features/settings/search.ts`: add an entry with keywords for any new section, and list its anchor on a page in `pages.ts`) |

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
  main/db/              Schema, 21 migrations, the node:sqlite shim
  main/services/        All business logic. The API
  main/ipc/             Thin adapters over services, behind the lock guard
  main/mcp/             Thin adapters over the same services, for agents
  main/windows/         Main, settings, setup, new-record, splash, the shared chrome, and `context-menu.ts` (the native right-click menu)
  main/tray.ts, notifications.ts, background.ts  The Windows half of the desktop: tray icon, taskbar badge, global shortcut, toasts (decision 63). Rules are in `services/desktop.ts` and `services/notifications.ts`
  main/vault.ts         safeStorage read and write, keyed by account id
  shared/               The contract both processes typecheck against
src/
  app/                  Shell, the icon rail, title bar
  features/             One folder per screen (11 of them)
  components/           Dialog, FormPage, SidePanel, Button, Field, Toast, Checkbox, Tabs, Segmented, Notice, CountBadge
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
| What a right-click menu offers | `electron/main/services/menu-registry.ts` (the items), `menu-actions.ts` (what the main process does itself), and the screen's handlers beside its `contextMenuFor` or `ActionMenu` (`src/lib/native-menu.ts`). A new kind is added to `shared/menu.ts` first |

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
7. **Nothing an agent can call queues a message by itself.** An agent writes
   drafts (`mail.draft`, `mail.reply`), which open in the editor, and asks to
   send a draft (`mail.send`) or a template (`mail.send_from_template`). Both
   park in `agent_actions` with the whole message as a preview, and only a
   person's approval under Agent, or the Send button, reaches `requestSend`
   (decision 44). A template is never a draft. Adding a way to queue that skips
   the gate is the one change that would make
   [.claude/rules/mcp.md](.claude/rules/mcp.md) section 4 false.
8. **An agent's call does not run when it is made, unless the owner allowed it.**
   Send, sign, file and delete always park in `agent_actions` and return a
   pending envelope; a person approves it under Agent and only then does the
   handler run (decision 24). Reads, changes and drafts follow their row's
   level, and an automation step that is not a read always parks (decision 57).
   The host test in `electron/main/mcp/host.test.ts` checks a new tool's flags against
   what the rules require, and is meant to fail when they do not match.
9. **Sync cannot write, and the type it is handed enforces that.**
   `MailboxSource` has no method that writes. Filing goes through
   `MailboxWriter` in `mail-writer.ts`, and the Sent copy through a third
   interface again. Every filing call changes the server first and the local
   rows second, so a server that cannot be reached fails the whole call with
   nothing changed here. The one thing that acts on the server after a pass is
   the owner's mailbox rules (decision 64): sync is handed a hook
   (`afterInbox`, wired in `main.ts`) and keeps no import of the filing code.
   A rule runs on a message once, ever, remembered by Message-ID in
   `mail_rule_seen`, and only on mail newer than `mail_accounts.rules_since`.

10. **A mail template canvas compiles to flexbox and grid, and Outlook cannot
    render either.** Outlook on Windows uses Word's engine, so it stacks every
    section into one column and drops the gaps and the alignment. That was
    chosen over compiling to nested tables, and the section inspector states
    it where the choice is made. A columns table is the one layout that is a
    table, for what has to stay side by side. Nothing in the model is positioned: custom
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

A new event, client, project or reminder is the third modal child (decision 60):
a 720 by 640 window at `#/new/<kind>`, built in `src/features/new-record/`, opened
by the New menu, the palette, Ctrl N, the calendar grid and the quick adds on a
client or project record, which pass a prefill in the address
(`shared/new-record.ts`). `window.childClosed` carries `{ created }`, and
`useRecordsChanged` (`src/lib/new-record.ts`) is how a screen reads again.
Editing one of the four is still a page.

`onboarding` lives in `settings.json`, not the database, so replacing the
database does not replay setup and `npm run dev:clean` does.

## Before saying something works

`npm run check` is lint, typecheck and test together. `npm run smoke` is
required for anything touching the main process, the preload bridge, the
schema or the windows. Anything visual gets looked at in both themes. The
traps and the full definition of done are in
[.claude/rules/verify.md](.claude/rules/verify.md).
