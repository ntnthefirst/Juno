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
| **Clients** | Clients, contacts and projects, with search and undo. A client has a language (`nl`, `nl-je`, `fr`, `en`, decision 67). A record opens on a card, with tabs (Overview as Details, Open work and Notes with the managing sections below, Timeline drawn as a line with a node per entry, Projects, Documents, Mail from `ClientMail.tsx`), including a status change made from the button beside the name. The list's "..." in the title bar clears filters and sorting |
| **Projects** | A piece of work. Cards, rows or a dense list; a project need not belong to a client. A record opens on a header (name, status, client and due date, an Add menu and a "..." menu) over six tabs (`features/projects/`): Notes (live Markdown saved as typed, a Details column, then its links and start commands), Documents (its documents, and its own files under them), Mail (the conversations filed under it, linked from a picker or from the reader), Timeline (read back from the records, `services/project-timeline.ts`), Time (entries and one app-wide timer, `services/time-entries.ts`, shown in the title bar by `app/TimerPill.tsx`, decision 56) and Calendar (its dates and reminders). Archive sets an Archived status. The "..." and Add buttons are `components/ActionMenu.tsx`, which opens the same native menus as a right click |
| **Notes** | The sixth place on the rail (decisions 61 and 81). A list on the left with a search (FTS5, `services/notes.ts`), split by day, pinned notes first, and the open note on the right: a title, "Edited today at 09:12", and lines that are text, bullets or checklists, saved as typed (`features/notes/`, `components/BlockEditor.tsx`). A note may belong to a client or a project, and its right-click menu is native (Pin, Duplicate, Move to a project, Delete). Delete parks like any other when an agent asks |
| **Files** | The seventh place on the rail (decision 82, `features/files/FilesScreen.tsx`): the owner's own documents, kept under no client and no project. It is the Documents tab below with no record, with Files as its heading, a search in the title bar, and New (a page) and Add files keeping what they make there (`documents.listUnfiled`) |
| **Documents** | On a client's and a project's Documents tab (decision 81, `features/documents/DocumentsPanel.tsx`), and in Files for the owner's own, and there are no folders. A bar with the heading and a count ("3 of 7 selected" while anything is selected), the view switch (a dense list or tiles with pictures, remembered in `explorer-prefs.ts`), New (a page, or an existing document brought here) and Add files; under it a bordered card with Name, Type, Size, Modified, Status and Versions, and Project on a client's tab, which lists its projects' documents too (`ExplorerView.tsx`). A project's own files sit under its documents as Project files. A click opens the full preview over the content area (`DocumentDetail.tsx` in `components/FullPreview.tsx`, Previous and Next through the list, the details column can be put away), held for the double-click time (`lib/click-timing.ts`), and closing it comes back to the tab; a double click opens the file in its app. Ctrl and Shift select (`lib/list-selection.ts`), and the list keys are `lib/list-keys.ts`: Space, Enter, F2, Delete, Ctrl A, D, C, X and V, on the rows and on the list's empty space. Copy and paste go through the system clipboard, read in the main process (`services/clipboard.ts`, the Windows side in `services/clipboard-system.ts`, decision 82): documents copied here paste as copies, and files from Explorer, a picture or text go through Add files. Files dropped on the tab or chosen with Add files are kept for that record, and one that looks like a document already kept is shown beside it first (`AddFilesFlow.tsx`), with what differs word by word when both have words (`services/document-compare.ts` over `services/text-diff.ts`, `TextDiffView.tsx`, and `documents.compare` for an agent). Copy to and Move to pick Files, a client or a project (`RecordPickerDialog.tsx`, `place-options.ts`), and Duplicate copies a page with its pictures too. A document with a file is dragged as the platform's drag of a copy of its newest file named by its title (`services/document-drag.ts`, `lib/document-drag.ts`), so it lands on the desktop, in Explorer or another app, and attaches when let go of on the composer; the right-click menu is the platform's (`file` kind, with a `several` context for a selection, decision 82). Signing, sending and a page take the record's screen (`DocumentTakeover.tsx`), and a document asked for from another screen is previewed over it (`DocumentCover.tsx`, `lib/return-to.ts`). A mail attachment and a project's file preview in the same frame (`components/FileQuickLook.tsx`), and an attachment is saved to documents from there. A document keeps every file it has been as a version, opens as the newest, and recognises an incoming file that is one of its versions by its text. Signed by opening the PDF with the stamp on it, placing it (on a page turned by a quarter turn too, `visibleFrame` in `services/pdf-sign.ts`) and pressing Sign, or Sign digitally with the owner's own certificate. The signing details go in a `.cert.pdf` beside the signed file, opened from the version list, so the signed PDF gains no page. A page is a document too (decision 62, `services/pages.ts`, `features/documents/PageView.tsx`): blocks of text, headings, checklists and tables written in place, saved as typed, with a slash menu, a format toolbar (marks, lists, a link and a picture) and Ctrl F, which reaches table cells too. A link opens only after `safeLinkHref` (https or mailto), and a picture is a file in the page's own folder, kept by `services/page-images.ts` and shown over `app://asset/page/` (decision 68). A document is kept under a client, a project, both or neither (decisions 48, 81 and 82), and a Documents tab adds one from an import, a page, a paste, or a search over the documents that already exist. Document templates were removed (decision 82): their rows are soft deleted by migration 0036, and a document made from one is an ordinary document that prints its stored body. A preview shows a PDF in the viewer and anything else by its kind (`components/FilePreviewView.tsx`), with the details, a version picker and a timeline in the column on the right. Looking at an older version and then emailing, downloading or signing asks first, in a native dialog. **Behind the screen (decisions 75 to 77):** any file is a document, and a version records its name, media type and size (`documents.pdf_path` is the newest version's path whatever its type). An incoming file is matched by its bytes, its words (PDF through pdf.js, Word through Mammoth, `.xlsx` through ExcelJS, CSV and text; `services/file-text.ts`) or its name, each candidate with its reason. Mammoth, ExcelJS, the CSV reader, pdf.js and the word comparison (`services/text-diff.ts`) run in a worker thread, never on the main process (`workers/file-worker.ts`, jobs in `services/file-jobs.ts`, started lazily, reused and given thirty seconds a job by `services/file-reader.ts`); the size and ZIP checks stay in the main process, and tests start the worker from the sources through `workers/file-worker-fixtures.ts`. Moving, duplicating, copying and renaming are `services/document-organise.ts`, and where a document is kept is `services/document-place.ts` over the owner rule; `document_folders` is kept, its rows soft deleted by migration 0035, and nothing reads it. Every file has a preview made in the main process (`services/file-preview.ts`): a PDF as bytes, a picture, an SVG, a Word file as sanitised HTML and an iWork file's own picture from `app://preview/<token>` with its own policy, a spreadsheet as cells, text as text, and anything else the thumbnail Windows draws. Opening a document in its app opens a working copy under `.working/` in the documents folder, and an edit saved there becomes a version when the window gains focus or the document is read (`services/document-working.ts`, `document_working_copies`); a signed or older version opens read only. Convert to PDF goes through Word when it is installed (`services/word-convert.ts`) and through Juno otherwise (`services/document-convert.ts`), and signing refuses a newest version that is not a PDF |
| **Mail** | New message and Styled mail sit in the title bar; Styled mail opens a column on the right to preview and send templates. IMAP accounts pulled into SQLite. Threads, a sandboxed reader, search, client linking. The composer opens in the pane beside the folders, with the page title empty, as the design draws it. The composer attaches any document, searched, and any file from this computer by picker or drop; those are sent and not kept unless ticked: a PDF becomes a document, anything else a file of the message's project (decisions 49 and 50). A conversation can be filed under a project from the reader, which lists it on the project and lets its attachments go into the project's files. An attachment saves to the conversation's project, or its client, in one click from its chip, its right-click menu (the `attachment` kind) or Save all, each checked like a drop (the same bytes skipped, a likely version compared first); one already kept by its bytes shows In documents and opens that document; a conversation filed under nothing asks where, starting from the project its mail suggests, and can be filed there in the same step (`services/document-mail.ts`, `features/mail/AttachmentPlacePage.tsx`, decision 79). Filing that reaches the server, and an outbox that sends over SMTP behind a confirmation gate. Each mailbox has rules written by the owner on its account page in settings (`services/mail-rules.ts`, `src/features/settings/mail-account/`, decision 64): tests on the sender, recipients, subject, client and attachments, and actions that mark read, flag, link, move, trash or archive, checked top to bottom on new inbox mail after each sync, once per message, with a history row for every action. Two buttons at the start of the composer toolbar add an intro and an outro (`mail_blocks`, `services/mail-blocks.ts`, `src/features/mail/blocks/`): a rule per block picks one for a new message, its variables sit in the composer as chips and take their values when the message is sent, and a variable with no value stops the send (`shared/mail-variables.ts`, decision 66), the one higher in the list wins, and a right click opens the manage page, which is reached from Mail and returns to the composer. Reading: a link in a message shows its real address in a popover (the frame reports it, `LinkPopover`), Ctrl F finds in the open message (`components/FindBar.tsx`, the frame does the searching), and calendar, project and reminder suggestions sit under the header (a project named in the words is offered as a link of the conversation to it, and a request by a day or a promise to follow up as a reminder, decision 70; `services/suggestions.ts`, answers in `mail_suggestion_states`, switches in settings.json). Sending an agent's draft yourself closes its request (`agent-actions.closeForSentDraft`). A message that has not gone out is edited or deleted, never cancelled: Edit takes a waiting, queued or failed one back to a draft first (`mail-outbox.returnToDraft`, decision 78). |
| **Calendar** | The month heading, previous, Today, next and the view switch live in the title bar (`TitleBarSlot` left), New reminder, import, export and the layers behind its "...". Events and recurring series with an IANA zone each, month, week and agenda views, drag to move and resize, .ics in and out. Reminders and project deadlines on the grid can be edited, completed, deleted and dragged too. A client or a project lists its own dates and reminders (`ScheduleSection`) and can add them from there. Calendar subscriptions (decision 74, `services/calendar-subscriptions.ts`, `features/settings/calendar-subscriptions/`) are read from an https address on a schedule and drawn read only in their colour; each can be hidden from the "..." menu, and their address is kept like a password |
| **Agent** | An MCP server on a localhost URL that a client is let into with a code, each tool in one of five permission rows (read, change, drafts, send and file, delete) whose level is set under Settings > MCP > Permissions: Off refuses, Ask first parks for approval, Allow runs, and send, sign, file and delete can never be Allow (decision 57, `services/agent-permissions.ts`). The owner's instructions are handed to a client when it connects. Requests, Log and Automations are its three tabs (decision 58). A request is one sentence from `services/agent-summary.ts`, and an answered one stays as a card, with View mail where the mail still exists. The log records reads as well as changes (decision 68), purging reads after thirty days and everything else after six months. Automations, briefings across every domain |
| **Templates** | Mail templates laid out on a canvas that is a tree of tagged elements (containers of eight tags that nest, columns tables, text of any tag, pictures, dividers and inputs) in a Figma-shaped editor: layers on the left, a pannable sheet at three reading widths, a design panel on the right with fills, strokes, effects, actions (a link on click, a fill, colour, underline or opacity on hover), typography and linked fonts, Figma's resizing, colour picker and keyboard with undo, breakpoints sent as media queries, a floating toolbar of five groups, each with a menu and a key for every element (the button is a text with a link, in the Text menu), text edited in place, and any element convertible to its own HTML and CSS. A canvas is sent with nothing around it. A first install is given one example laid out on the canvas and no other mail template. Compiled to the HTML a message is made of, with an editable code view back into it. A mail template fills in its own inputs and nothing from a record (decision 47): it is read on a page of its own with Edit and Use above the whole message, and used as Link (recipient, account, client to file it under), Fill, Review. There are no document templates (decision 82) |
| **Shortcuts and search** | One palette (Ctrl or Cmd K) goes to a screen, starts a new record, or finds a client, project, document or conversation by name. Digits go to the seven places and the agent, Ctrl or Cmd N starts a new record on the screen in view, Alt Left backs out of a record, Ctrl or Cmd slash shows the sheet. The title bar holds Search, Recent, Reminders and New at the left (New offers note, event, client and project), the page title in the middle, and at the right the screen's own controls, New, a record's "..." (`TitleBarSlot` sides `right` and `overflow`) and the agent; the palette is grouped (Go to, Clients, Projects, Mail, Notes, Documents) and has tabs to narrow it, and the lock is a palette command and Ctrl or Cmd Shift L. Right-click menus are the platform's and carry icons the renderer draws and hands over (`lib/menu-icons.tsx`, decision 59). Pages fill the window, and what arrives is animated (`styling.md` sections 5d to 5f) |
| **Settings** | An 888 by 664 window (decision 69). Theme, lock (one switch), reference data, owner profile, accounting link, mail accounts (added from a provider tile or an address, signed in with a password, an app password with a guide, or Microsoft in the browser, and saved only once receiving and sending both work; `features/settings/add-account/`, `shared/mail-providers.ts`, decision 73), a documents folder and the signature image, release notes for every version (`build/release-notes.md`, decision 71, shown again for an incoming update under Updates), backup with the agent log purge and the Recent list, what an agent can do (kind and calls), and a search over all of it (`features/settings/search.ts`: add an entry with keywords for any new section, and list its anchor on a page in `pages.ts`) |

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
  editors.md            How the note and mail template editors are specified
  templates.md          The mail template format, and what a specimen is
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
  main/db/              Schema, 37 migrations, the node:sqlite shim
  main/services/        All business logic. The API
  main/ipc/             Thin adapters over services, behind the lock guard
  main/mcp/             Thin adapters over the same services, for agents
  main/windows/         Main, settings, setup, new-record, update, splash, the shared chrome, and `context-menu.ts` (the native right-click menu)
  main/workers/         `file-worker.ts`, the worker thread that parses Word files, workbooks, CSV and PDF text off the main process
  main/tray.ts, notifications.ts, background.ts  The Windows half of the desktop: tray icon, taskbar badge, global shortcut, toasts (decision 63). Rules are in `services/desktop.ts` and `services/notifications.ts`
  main/vault.ts         safeStorage read and write, keyed by account id
  shared/               The contract both processes typecheck against
src/
  app/                  Shell, the icon rail, title bar
  features/             One folder per screen or family (14 of them, including `files/`, `new-record/` and `onboarding/`)
  components/           Dialog, FormPage, SidePanel, Button, Field, Toast, Checkbox, Tabs, Segmented, Notice, CountBadge
  lib/                  Renderer-only helpers and the typed bridge client. A list that means "all of them" reads page by page with `list-all-clients.ts`, `list-all-notes.ts` or `list-all-threads.ts`, because a service list stops at its default page without saying so
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
| Where a link to a record lands, and where closing it goes back to | `src/lib/open-entity.ts` (the requests), `src/lib/return-to.ts` (which open over the screen they came from), and the shell in `src/app/App.tsx` |

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
   fix. A file's preview is the same shape on a host of its own:
   `app://preview/<token>`, a token `services/file-preview.ts` issued for one
   preview and keeps in memory, never a file name (decision 76).
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
the same shape as settings and smaller (decision 34, sizes in 69): welcome, about you, your business,
appearance, lock, mail, ready. It cannot be skipped as a whole, and closing
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
Editing one of the four is still a page. Event and reminder are one window with
an Event | Reminder switch (`NewEventWindow.tsx`): `#/new/event` and
`#/new/reminder` only pick the side it opens on. A new event always takes the
computer's time zone, and the event edit page has no zone field either.

`onboarding` lives in `settings.json`, not the database, so replacing the
database does not replay setup and `npm run dev:clean` does.

## Before saying something works

`npm run check` is lint, typecheck and test together. `npm run smoke` is
required for anything touching the main process, the preload bridge, the
schema or the windows. Anything visual gets looked at in both themes. The
traps and the full definition of done are in
[.claude/rules/verify.md](.claude/rules/verify.md).
