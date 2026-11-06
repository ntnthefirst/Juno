# Todo

Things that are deliberately not done yet, and what unblocks each. Anything with
a **you** tag needs Nathan rather than a session.

---

## 1. Your own real document templates - **you**

Nothing that ships is fit to send to a client. A new install gets one example
document template and it is a specimen. An install that still has the five
invented templates from phase 1 (`nda`, `development_agreement`,
`hosting_agreement`, `project_scope`, `addendum`) keeps them as they are, and
they are specimens too.

**Still yours.** Write your real contract templates in the app, from the
example or from nothing. The placeholder syntax and the fields are in
`docs/templates.md`. **Do not send a document generated from an unreviewed
template to a client.** That is what the banner is for.

## 2. Decide what the in-app assistant runs on - **you**, parked

**Parked on purpose.** Not now; picked up later. Until then an external agent
does the job, as below.

Phase 6 is built except its assistant panel. Everything the panel would drive
is there: 170 tools, the approval gate, briefings and automations. What it needs
and nothing else does is a model, which means three answers from you.

- **Which provider**, and whether Juno ever talks to one at all. PLAN.md is
  binding that the app opens, syncs and works with no key configured, so the
  panel is additive and absent by default.
- **Where the key lives.** `safeStorage`, like a mail password, by decision 6.
  Nothing about a key belongs in `.env` or the build.
- **What it may do unattended.** Nothing changes about the gate: an assistant
  is a caller like any other and its side-effectful calls park for approval.

Until then an external agent does the same work. Connect Claude Desktop
(an extension) or Claude Code (an address) under Settings > MCP. That also
answers phase 6's done-when in PLAN.md.

## 3. Things only you can try - **you**

Everything decided and buildable in this section is built. What is left needs
your hands, a real account or a real client, rather than code.

- **No real mail server has been used yet.** Reading and sending are proven
  against a mailbox and a transport held in memory.
- **No other calendar has read a Juno .ics file yet.** Export a month, open
  it in Google Calendar or Outlook, and check the moved occurrence of a
  recurring event after the October change. Then import an Outlook export the
  other way; its Windows zone names are handled through the file's VTIMEZONE,
  which is tested against a hand-written one and not yet a real one.
- **Claude Desktop has not installed the extension yet.** Claude Code
  connects by address and works. Press Connect next to Claude Desktop in
  Settings > MCP, install, paste the token, and call a tool from a chat. Then
  close Juno, check the chat says Juno is not running, and open it again.
- **The example mail template has not been read in a real mail client yet.**
  Use it on a client whose address is yours (Mail templates, the example,
  Use), create the draft and send it to yourself. Put a real logo and a real
  photo address in first: the two at example.com will not load. Then open it in
  Gmail on a phone and in Outlook on Windows, and write down what each shows.
  Expect Gmail to show Arial for the heading, since it loads no web fonts, and
  no hover colour on the button; expect Outlook on Windows to stack the two
  columns, keep the comparison table side by side, and paint no gradient,
  shadow, rounded corner or transparent colour. Anything else is a finding.

## 4. Not tasks

Written down so nobody builds them by accident.

- **Nothing files mail on its own except the owner's mailbox rules** (5b).
  An agent or an automation still cannot: filing is side-effectful, so it is
  excluded from anything unattended by the same rule that keeps sending out of
  an automation.
- **An automation cannot pass one step's result to the next.** Anything that
  needs the output of a previous step is a job for an agent, which can read and
  then decide, rather than for a recording.

## 5. Mail rules: greetings for every message, automation per mailbox

Two kinds of rule, and they live in different places on purpose. Greetings and
sign-offs apply to every message from every account, so they are one list.
Automation belongs to one mailbox, so each mailbox has its own list.

Both are built like Cloudflare's rules: a rule has a **name**, an on and off
switch, **conditions** and **what it does**. Rules sit in an **ordered list**
that is reordered by dragging, and are checked top to bottom. Stored in the
database with the five columns, behind a service, IPC channels and MCP tools,
like everything else (decision 2).

### 5a. Greetings and sign-offs

**Being built separately, not on this branch.** An unfinished start is on the
branch `wip/mail-phrases`: the schema and migration 0015, the service with its
tests, the IPC and MCP adapters, and the composer inserting the greeting and
sign-off. The Settings screen, the smoke steps and a full `npm run check` and
smoke run are still missing. Whichever of 5a and 5b lands second regenerates
its migration so the numbers do not collide (data.md section 3).

The way Outlook does signatures. Nothing to do with templates.

- **Greetings and sign-offs are named, static texts.** The owner keeps a list
  of each, as many as they like, each with a title and a text. For example a
  greeting "Basic" with "Beste,", and a greeting "Reply to clients" with
  "Beste," and "Bedankt voor uw bericht." on the next line. Sign-offs the
  same way. Static means
  plain text, no placeholders, so there is nothing to fill in and nothing that
  can come out empty.
- **Rules decide which one goes where.** A rule has a name, conditions, and
  which greeting and which sign-off it adds (either may be none). Conditions:
  - what the message is: new, reply or forward;
  - who it goes to: a client, a known contact, or anyone else;
  - which account it is sent from.
  So "every new mail" adds "Basic", and "every reply to a client" adds
  "Reply to clients".
- The first rule that matches decides. The composer puts its greeting and
  sign-off in when a message is started, and they stay editable there. No rule
  matches, nothing is added.
- Edited in Settings > Mail accounts, above the accounts, because it is common
  to all of them: the greetings, the sign-offs, and the rules.

### 5b. Automation rules per mailbox

- **The account gets a detail page.** Settings > Mail accounts lists the
  connected mailboxes; clicking one opens its page (a `FormPage`, decision 30)
  with its details, its folders (the folders dialog moves here) and its rules.
- **When they run.** On every sync of that mailbox, on new incoming messages in
  its **inbox** only. Not on sent mail, not on other folders, and not again on
  a message a rule has already seen.
- **Conditions** on the sender, the recipients, the subject, whether the
  sender is a client, and whether it has attachments.
- **Actions**, one or several per rule: move to a folder, move to trash,
  archive, mark read, flag, link the thread to its client. For example "from
  this address: mark read and move to trash".
- **Order, like Cloudflare.** Rules run top to bottom. Each rule has its own
  choice of whether a match stops the rules below it or lets them run too.
- **The owner's rules may file on their own.** Moving and deleting on the
  server is filing, which the project otherwise never does unattended
  (mcp.md section 4). A rule the owner wrote and switched on is the owner's
  standing instruction, so it runs without asking each time. That is an
  exception, and it covers these rules only: an agent may create or edit a
  rule only through the approval gate, and an automation may not run one.
  Write the exception into docs/decisions.md in the same commit.
- Every action a rule takes writes an audit row naming the rule, so "why did
  this message move" always has an answer.

## 6. Components for document templates on paper

Parked on purpose: the paper canvas shipped first (decision 41), and
components come after it if there is time.

- **A component is a piece of a page made once and placed in many templates**:
  a letterhead, a signature block, a price table. It is made in the same canvas
  editor, as a container rather than a page, and stored in its own table with
  the five columns, behind a service, IPC channels and MCP tools.
- **A component declares inputs of its own.** Placing one in a template asks
  for its values there, or passes one of the template's own inputs through, so
  a letterhead can ask for a reference number without every template declaring
  it by hand.
- **Placed, not pasted.** A template holds a reference to the component and the
  values given to it, so editing the component changes every template that uses
  it. A template can detach one, which copies its nodes in and drops the link.
- **Pictures** a component keeps belong to the component, not to each template.
- **What has to be decided first:** whether editing a component clears the
  review flag of every template that uses it (it changes their text, so it
  probably should), and whether a document already generated keeps the
  component as it was (it does today for everything else: the body is frozen).

## 7. Document templates on paper: smaller things left

- **The example that ships is still on the page model.** A first install gets
  one example document template laid out as pages, and it uses record values.
  Rewriting it on the canvas, with inputs for what it now reads from the
  records, would make the first thing a new owner opens the editor they will
  use.
- **No real Word file has been imported yet.** The reader is tested against
  Mammoth's own output and a hand-built `.docx`. Import one of your contracts
  and write down what comes across wrong.
- **Hover actions are offered on paper** and do nothing there. The design panel
  could leave them out for a document.

---

## Signing: what is deliberately not there

- **itsme and eID.** A digital signature uses a .p12 or .pfx certificate the
  owner imports in Settings > Documents. itsme needs an agreement and client
  credentials, and the eID key never leaves the card, so it needs a card reader
  driver and a native module. **You**: an itsme or signing-provider agreement, or
  a decision to take on eID through PKCS#11. See decision 38.
- **A trust check.** The certificate is checked for a key, a validity period
  and its intended use. It is not checked against a trust list, and no
  timestamp authority is used, so a signature does not carry a trusted time.
  Adding both is what would make it verifiable after the certificate expires.
- **Deleting a version.** Versions are only ever added. Removing one changes
  what the document opens as, so it needs the same confirmation as any delete.
- **Scans.** A PDF with no text layer cannot be matched to a document, only
  imported, until there is OCR.
- **Rotated pages.** A page with a rotation is refused by the stamp, with a
  message. Rotate it upright first.

## 8. The Figma design: what to build, and exactly how

The design file goes further than the app, and in a few places the app is ahead
of it. This section is the hand-over. Every package below can be picked up on
its own by someone who has read this file, `CLAUDE.md` and the rules it links.

Nothing in section 8 is started unless it says so.

### 8.0 How to work from this section

**The design file.** `https://www.figma.com/design/NtjBTCWVPZ8DGghqdCxOeR/Juno`
(file key `NtjBTCWVPZ8DGghqdCxOeR`). Windows only for now. Three pages:
Stylesheet (`1:2`, palette, type, spacing, radius, logo), Components (`0:1`) and
Screens (`1:3`).

**Reading a node.** A node id is written `84:8459`. In a link it is
`?node-id=84-8459`. With the Figma tools, call `get_design_context` for the code
view and `get_screenshot` for the picture, with the file key above and the node
id. Screen frames are 1440 by 940 (settings windows 888 by 664, new-record
windows 720 wide) and are named `NN Screen / State`. Treat a screenshot as the
truth for layout and the text in it as the truth for copy, except where a
package says the copy is a placeholder.

**The design is the reference for values** (decision 50). The tokens already match
it, so use the token utilities and the text styles (`text-h1` to `text-overline`),
never a pixel read off a frame. Take behaviour from the package text below.

**Every package follows the same rules.**

- One capability is a service function first, then an IPC handler and an MCP tool
  in the same commit (decision 2, `.claude/rules/architecture.md`,
  `.claude/rules/mcp.md`). A screen with no tool behind it is unfinished, except
  where the package says "interface only".
- A new table has the five columns and a soft-delete filter on every read
  (`.claude/rules/data.md`). A schema change is a migration made with
  `/migration-new`.
- Anything that sends, signs, files or deletes is confirmed in the service and
  never fires unattended (`.claude/rules/mcp.md` section 4).
- The interface is English, anything a client reads is Dutch (Belgium), and the
  copy has no em dashes, no exclamation marks and none of the phrases in
  `.claude/rules/writing.md`. Run its section 7 sweep before a hand-off.
- Styling uses tokens only, rows are 36px, numbers are tabular, both themes get
  looked at (`.claude/rules/styling.md`). A form is a page, not a modal.
- A new shortcut goes in `SHORTCUT_GROUPS` in `lib/shortcuts.ts` in the same
  commit. A new settings section gets an entry in `features/settings/search.ts`
  and an anchor in `features/settings/pages.ts`.
- Done means `npm run check` and `npm run smoke` clean, the screen looked at in
  both themes with `JUNO_SMOKE_DEMO=1 npm run smoke`, a test for the service
  function, and the MCP host test passing (`.claude/rules/verify.md` section 5).
- One commit per logical unit, no attribution of any kind, no push, no PR unless
  asked (`.claude/rules/git.md`). Commit this file's changes separately from code.

**Size tags.** S is under a day, M is a few days, L is a week or more. **you**
means a decision or a thing only Nathan can do, as at the top of this file.

**Order.** The decisions in 8.1 come first, because three packages are blocked
on them. After that the packages are independent unless one says "needs".
A sensible order is 8.2 package 1, 2, 3, then 5, 6, 7, 8, then 4 and 9.

### 8.1 Decisions to take first - **you**

Each one is written into `docs/decisions.md` (next free number is 51) in the same commit as
the code that depends on it.

1. **Greetings: the design's model or section 5a.** The design has intro and
   outro blocks with variable chips and one rule each. Section 5a has static
   text with no placeholders and rules with several conditions, and it is only
   an unfinished branch (`wip/mail-phrases`). Recommended: build the design's
   model and drop 5a, because the design is what was chosen after 5a was
   written. Blocks package 1.
2. **Notes as a place of its own.** The design's icon rail has a seventh entry,
   Notes, between Mail and Documents. `.claude/rules/styling.md` section 5b says
   a seventh place is a decision and not an edit. Options: add the entry (and
   change that section), or reach Notes from the Documents switch. Blocks
   package 4.
3. **What "Allow" may do for an agent.** The design's permissions page lets the
   owner set Read, Change records, and Write drafts to Allow, meaning the call
   runs without parking. Decision 24 as built parks every side-effectful call.
   `.claude/rules/mcp.md` section 4 already says a write that only touches local
   records may run directly, so Allow for those two is compatible with the rule
   and not with decision 24. Send, sign, file and delete stay locked to "Ask
   first" in both. Recommended: allow it for Change records and Write drafts and
   amend decision 24. Blocks package 6.
4. **Separate windows for creating a record.** The design draws New event, New
   client, New project and New reminder as small windows (frames listed in
   package 8). Decision 30 says anything with fields is a page, and decision 34
   allows one modal child at a time. Either the new-record windows replace the
   pages and join the one-modal-child rule, or they are dropped and the design
   frames are redrawn as pages. The owner asked for a window for calendar items
   specifically. Blocks package 8.
5. **Pages: a kind of document or a table of their own.** A page in the design
   sits in the Documents list and belongs to a client or a project, which is
   what a document does (decision 48). Recommended: a document kind, so the
   versions, ownership and timeline already built apply. Blocks package 4.
6. **Where automations live.** The design's Agent screen no longer lists them and
   no frame shows another home. They exist in the app (`features/agent/
   AutomationList.tsx`). Decide a home, then draw it in Figma first (8.5).
7. **Which wins, the tokens or the design.** Taken: the design (decision 50).
8. **When two intro blocks match.** The design gives each block one rule and
   says nothing about two blocks with the same rule. Recommended: the one higher
   in the list wins, and the list is reordered by dragging. Blocks package 1.

### 8.2 Packages

#### Package 1. Intros and outros in the composer (M, needs decisions 1 and 8)

**Figma.** Screens: `14 Mail / Compose` (`30:2564`), `Compose, intro menu`
(`84:8459`), `Compose, outro menu` (`119:11074`), `Compose, manage intro`
(`119:11359`), `Intros and outros` (`105:10178`). Components: Editor Tool
(`119:10979`), Block Menu (`118:1620`), Block Menu Row (`118:1543`), Variable Chip
(`102:1521`), Context Menu set (`76:2231`, variant `Kind=Block`), icons
`Icon/Intro` and `Icon/Outro`.

**Behaviour.**

- The composer toolbar starts with two 36px icon buttons, intro then outro, then
  a divider, then bold, italic, underline, list, rows, link, image. There is no
  Insert button. Both have tooltips ("Intro", "Outro").
- A click opens a list under the button, 276px wide, closing on Escape or a click
  elsewhere. It has a small heading ("Intro" or "Outro"), one row per block with a
  check on the block in use, its name and, at the right in muted text, the name
  of its rule ("Clients", "New contacts", "Replies", "Manual"). Then a divider
  and a "No intro" or "No outro" row. Then a preview well showing the text of the
  row under the pointer, or of the one in use when nothing is hovered, with
  variables drawn as chips. Then one muted line: "Right click the icon to manage".
- Choosing a row puts that block at the very start (intro) or very end (outro)
  of the body, replacing the one there. Choosing "No intro" removes it. Both stay
  editable text in the message, and a block never sends anything by itself.
- A right click on either button opens the manage menu: "Edit this intro" (or
  outro), "New intro", a divider, "Manage intros and outros". The first two open
  the manage screen on that block, or on a new empty block of that kind. The
  last opens the manage screen. Use a native menu (package 7), not a drawn one.
- The manage screen (`105:10178`) is a page, reached from Mail with a back link
  labelled "Mail". Left: the blocks, grouped Intro and Outro, each with its name
  and a one-line rule description ("Added when you write to a client"), and a
  "New block" button. Right: the editor for the selected block. Fields: Name,
  Text, with an "Add a variable" menu (Client name, First name, Project, Date,
  My name) that inserts a chip. A radio list headed "When to add it": "I add it
  myself, never automatically", "I write to a client", "I write to someone who is
  not a client yet", "I reply to a mail", "The mail is linked to a project". A
  note: "You can still change or remove it in the mail. An intro or outro never
  sends anything by itself." A live preview. Delete and Save.
- A variable is stored as a token in the text and drawn as a chip, never as
  curly braces, in the editor, the menu, the preview and the composer. A variable
  with no value (First name for a recipient with no name) makes the rule not
  match, so the block is not added automatically. The owner can still insert it
  by hand and sees the chip stay empty in the preview.
- Automatic insertion happens once, when the composer opens or the recipient
  becomes known, and never again after the owner has chosen "No intro" or edited
  the line.
- The text of a block is what a client reads, so it is written in Dutch
  (Belgium). The interface around it is English.

**Build.** A table `mail_blocks` (kind `intro` or `outro`, name, body with tokens,
rule, sort order) with the five columns. A service `services/mail-blocks.ts`:
`list`, `get`, `create`, `update`, `remove` (soft delete), `reorder`, and
`resolve(context)` which returns the block a new message gets, given whether the
message is new or a reply, whether the recipient is a client and the project link.
IPC channels under `mail.blocks.*`. MCP tools `mail.list_blocks` (read only) and
`mail.create_block`, `mail.update_block`, `mail.delete_block` (local writes, flagged
side-effectful, never scheduled). Seed: a first install gets the design's five
examples (Formal, Friendly, Short, Kind regards, Best wishes) as ordinary rows,
not system rows, like the example mail template. Remove the composer's old
pickers, and if section 5a was started on `wip/mail-phrases`, close that branch.

**Done when.** The composer behaves as above in both themes. Tests cover `resolve`
for each of the five rules, the empty-variable case and the tie-break. The manage
screen saves, deletes and reorders. The MCP host test passes. Section 5a is
replaced by a note that points here.

#### Package 2. Mail reading: links, suggestions, find, closing a request (M)

**Figma.** `14 Mail / Reading` (`30:2336`), `Reading, link hover` (`106:10280`),
`Reading, find` (`89:7543`), `Sent, request closed` (`89:8186`), the request
banner in `Compose` (`89:8178`). Components: Suggestion Bar (`84:2156`), Find Bar
(`88:2241`), Notice (`20:701`), Request Banner (`88:2320`).

**Behaviour.**

- **Links are clickable.** In the reader a link is underlined and in the accent
  colour. Hovering it shows a small popover under the pointer with the real
  address (never the anchor text), "Open in browser" and "Copy link". Opening goes
  through the https check in `.claude/rules/security.md` section 3, and a link
  that is not https shows the popover with "Open in browser" removed. The message
  is in a sandboxed frame (`mail-frame-script.ts`), so the frame posts the link
  and its position to the window, and the window draws the popover. The frame
  gets no new permission.
- **Suggestions under the header.** Two bars from the design: "Janssens mentions
  Friday at 10:00. Add 'Delivery, oak table' to the calendar?" with Not now and
  Add to calendar, and "This looks like part of Kitchen cabinets. Link this
  message to the project?" with Not now and Link to project. Detection is local
  (dates in the text, a client or project name in the thread), runs on the
  main process, and nothing is filed or created until the button is pressed. Not
  now hides that suggestion for that message for good. A switch per source lives
  in Settings > MCP > Permissions (package 6) under "Suggestions". Check first:
  `features/reminders/SuggestionList.tsx` and `services/reminders-derive.ts`
  already derive suggestions for the overview, so share the shape.
- **Find in a message.** Ctrl F opens the find bar at the top of the reader, with
  a count ("1 of 2"), next and previous, Escape to close. Matches are highlighted
  inside the frame. The same bar component is used in pages (package 4).
- **A request closes when you send it yourself.** An agent asks to send a draft.
  If the owner opens that draft and presses Send, the request it answered is
  closed by itself. The composer shows the request banner ("This draft answers an
  agent request. Send it here yourself and the request closes by itself.", with
  "View request"), and after sending a notice ("Sent. The request 'Ask to send a
  draft' is closed."). The Log shows the outcome "Sent by you, request closed"
  (`32:3369`). The send goes through the normal path and the gate in decision 44.
  Closing the request must never send a second time.

**Build.** Links: the frame script and the reader. Suggestions: a service
`services/suggestions.ts` with `forMessage(id)` and `dismiss(id, kind)`, IPC
`suggestions.*`, MCP `suggestions.list` read only. Find: renderer only. Request
closing: in `services/agent-actions.ts`, when a draft linked to a parked
`mail.send` is sent by hand, mark that action closed with that outcome, in the
same transaction as the send.

**Done when.** Tests cover the closing rule (closed once, not sent twice), the
dismissal and the https check. The reader and the composer match the frames in
both themes. No new permission was added to the message frame.

#### Package 3. The project record (L, needs a migration)

**Figma.** `13 Project Record / Notes` (`29:2223`), `Menu` (`98:10622`), `Add
menu` (`98:10829`), `Mail` (`98:11026`), `Timeline` (`98:11246`), `Time`
(`98:11492`), `Calendar` (`98:11719`). Components: Context Menu `Kind=Project`
and `Kind=Add` (set `76:2231`), Tab (`13:166`), Section Card (`18:399`).

**Behaviour.**

- **Header.** Avatar tile, project name, a status badge, "client, due date", an
  Add button and a "..." button. Tabs: Notes, Mail, Timeline, Time, Calendar.
- **"..." menu.** Open folder (Ctrl O), Copy folder path, Change folder, Run start
  command, a divider, Archive, Delete (Del). The folder, its path and the command
  are not shown on the page any more. Run start command keeps its current
  confirmation (decision 35) and still has no MCP tool.
- **Add menu.** Link a mail, Add time entry, Add calendar event, Add file, Add
  note. Each opens the same form page or picker the matching tab uses.
- **Notes.** The existing Markdown notes, "Saved as you type", with the current
  sections, and a Details column: Client, Status, Due date, "3 threads linked",
  Next event, Time logged.
- **Mail.** "Linked mail. Threads you linked to this project." with Link a mail,
  the thread rows, and the line "Mail stays in your mailbox. Linking only shows
  the thread here." Mail to project links exist (`mail_threads_link_project`).
- **Timeline.** A vertical graph grouped by month, newest first, with a filter:
  status changes, mail linked, quote sent for signature, time entries, contract
  signed, project created, folder connected. Reuse `services/client-timeline.ts`
  for the shape and add a project timeline beside it.
- **Time.** Three figures (Logged, Estimated, Entries), then "Time entries, newest
  first" with date, title and duration, and a Start timer button. One timer may
  run at a time, and it is shown in the title bar while it runs.
- **Calendar.** "Events and reminders linked to this project", Add event, and
  Upcoming and Past lists.

**Build.** Migration: table `time_entries` (project id, optional client id,
started at and ended at as UTC ISO strings, duration in whole minutes, note) and
a nullable `estimated_minutes` on projects. Calendar events and reminders already
carry a nullable `project_id` with an index, so the Calendar tab needs no
migration. Service `services/time-entries.ts`:
`start`, `stop`, `create`, `update`, `remove` (soft), `list(projectId)`, `total`.
Project timeline in `services/projects.ts` or its own file. IPC `time.*`. MCP:
`time.list`, `time.start`, `time.stop`, `time.create`, `time.update` (local writes,
side-effectful flag, never scheduled). No tool runs or edits a command.

**Done when.** The five tabs and both menus match the frames in both themes.
Tests cover the timer (start, stop, a second start while one runs), the totals
and a rebuild migration run against a database with rows
(`.claude/rules/data.md` section 3).

#### Package 4. Notes and Pages (L, needs decisions 2 and 5)

**Figma.** `20 Notes / List and editor` (`73:4831`), `20 Notes / Context menu`
(`76:7290`), `21 Page / Editor` (`73:5038`), `21 Page / Find` (`89:7801`),
`15 Documents / New menu` (`73:5344`). Components: Note Row (`72:1200`), Editor
Toolbar (`72:1238`), Slash Menu (`72:1272`), File Row (`72:1237`), Find Bar
(`88:2241`), New Menu (`72:1314`).

**Behaviour.**

- **Notes.** A list on the left with a search field ("Search notes") and the count,
  split with `lib/day-groups.ts` (Today, Previous 7 days, then months) when
  ordered by time and not split when a search is active. Each row: title, time
  or weekday, one line of text. The editor on the right: title, "Edited today at
  09:12", checklists that tick, plain text, saved as typed. A note may belong to
  a client or a project, or nothing.
- **Pages.** A page opens from Documents (it is a kind of document, decision
  to be taken) and reads like a document: title, "Page", the client, "Edited
  today at 10:05", then blocks: text, heading, checklist, table. "Type to add a
  block" at the end, and a slash menu with Text, Heading, Checklist and the rest
  drawn in the frame. Find works as in package 2.
- **Mixed files in a project.** A project lists Word files, PDFs and images next
  to its notes and pages, with File Row.
- **Empty state.** Not drawn yet. Draw it first (8.5) with the mascot.

**Build.** Notes: table `notes` (title, Markdown body, optional client id and
project id) with an FTS5 table kept by the service (`.claude/rules/data.md`
section 7). Service `services/notes.ts`: `list`, `get`, `search`, `create`,
`update`, `archive`. IPC `notes.*`. MCP `notes.list`, `notes.get`, `notes.search`,
`notes.create`, `notes.update`, `notes.archive`. Reuse `components/
MarkdownEditor.tsx`. Pages: depends on decision 5, and then the document kind,
the block model (stored as JSON) and the editor. If Notes gets a sidebar entry,
add it to `app/screens.ts` (`ScreenId`, `SIDEBAR_TOP`, `SCREEN_LABELS`,
`SIDEBAR_ENTRY`, `NEW_ON`) and to the palette. The palette is grouped and has a tab
per group (`SCOPES` in `app/CommandPalette.tsx`): add Notes there. Recent takes a
new `RecentKind` in `shared/types.ts` and a case in `services/recent.ts`, and the
New menu (`NEW_MENU` in `app/screens.ts`) gets New note and New page.

**Done when.** A note and a page can be made, searched, found in, linked to a
client or project, archived and driven by an agent. Tests cover search and the
day grouping. The empty state exists.

#### Package 6. Agent permissions and instructions (M, needs decision 3)

**Figma.** `19 Settings / Agent` (`86:7434`, the Permissions page),
`19 Settings / Instructions` (`86:7569`), `17 Agent / Requests` (`32:3006`),
`17 Agent / Log` (`32:3369`). Components: Permission Row (`84:2243`), Permission
Switch (`84:2242`), Text Area (`84:2264`), Request Card (`18:562`).

**Behaviour.**

- **Settings > MCP gets two pages** after "What an agent can do": Permissions and
  Instructions. The MCP group is then Server, Connect a client, What an agent
  can do, Permissions, Instructions (`features/settings/pages.ts`).
- **Permissions** has five rows, each a three-way switch Off, Ask first, Allow:
  Read everything (clients, projects, documents, notes and mail), Change records
  and notes, Write mail drafts, Send mail, sign and file, Delete. Defaults: Allow,
  Ask first, Allow, Ask first, Ask first. The last two cannot be set to Allow, and
  the switch shows a lock on that option. Below, a "Suggestions" section with a
  switch per source ("From mail", and the same for documents).
- **Instructions** has "For everyone" and "For mail only" text areas, "Saved as
  you type", and "Add instructions for another area". They are handed to every
  connected agent as the server's instructions text when it connects.
- **Requests** and **Log** keep their layouts. The Log has When, Tool, Outcome and
  Who columns and keeps entries for six months.

**Build.** Keep the levels in `settings.json`, not the database. Enforce them in
`services/agent-actions.ts` (the service, not the adapter): Off returns a typed
error that names the setting ("Turned off under Settings > MCP > Permissions");
Ask first parks as today; Allow runs directly for the capabilities decision 3
permits. Send, sign, file and delete ignore the setting and always park. Return
the instructions text from the MCP server at initialisation. Check first:
`mcp/host.test.ts` must keep failing when a flag does not match the rules.

**Done when.** Tests prove the locked options cannot be reached through the
service, through IPC or through MCP. Both pages are in the settings search.

#### Package 7. Context menus everywhere, native (M)

**Figma.** `04 Overview / Context menu` (`76:7136`), `06 Calendar Month / Context
menu` (`76:7545`), `10 Clients / Context menu` (`76:7237`), `14 Mail / Context
menu` (`76:7471`), `15 Documents / Context menu` (`76:7359`), blank-area menu
(`76:7418`), `20 Notes / Context menu` (`76:7290`). Component: Context Menu set
(`76:2231`), kinds Reminder, Event, Client, Note, File, Mail, Blank, Project,
Add, Block.

**Behaviour.** A right click on a row, a note, a file, an event, a mail or the
blank area of a list opens the menu the frame shows, with the shortcuts it shows.
The menus are native (Electron `Menu.popup`) so they match Windows. The figures in
the file are drawings of them. Items call the same service functions the buttons
call, a destructive one asks first, and an item that does not apply is left out
and not greyed.

**Build.** One main-process module `windows/context-menu.ts` that builds a menu
from a registry (kind plus record id) and an IPC channel `menu.show`. The
renderer sends a kind and an id, never a list of items, so a script in the page
cannot invent one. Interface only: no MCP tool. Respect the lock.

**Done when.** Each kind opens with the right items, the keyboard menu key opens
it too, and no menu appears while the app is locked.

#### Package 8. Calendar layouts and the new-record windows (M, needs decision 4)

**Figma.** `06 Calendar Month / Default` (`26:693`), `07 Calendar Week / Default`
(`26:1026`), `08 Calendar Agenda / Default` (`26:1292`), `09 Event Window / Default`
(`58:4449`), `09 New client window` (`90:9301`), `09 New project window` (`90:9368`),
`09 New reminder window` (`90:9426`).

**Behaviour and layout.**

- **Month fills the window.** The weekday row is fixed and the six week rows share
  the rest of the height equally, so the grid always reaches the bottom edge. A
  day with more events than fit shows "+N more".
- **Week.** The all-day row is one cell high (32px) with the chips inside it, and
  grows only when a day has more than one all-day item. An hour is 40px. A 60
  minute event's title is a single line.
- **The new-record windows.** If decision 4 says yes: a small fixed window, a
  modal child of the main window, opened by New and by the palette, with the
  fields in the frame (the event window has Title, Date, Starts, Ends, Time zone,
  Repeats, Client, Notes, Cancel, Save event). It follows the one-modal-child rule
  and sends `window.childClosed` when it closes so the screen behind refreshes.
  If no: build these as pages and redraw the four frames.

**Build.** Check first whether `features/calendar/MonthView.tsx` and `WeekView.tsx`
already behave this way, and fix only what does not. The windows go in
`electron/main/windows/` next to `setup-window.ts`, entered by a hash route like
`#/new/event`.

**Done when.** Both calendar views fill their space at 1280 by 720 and at 1920 by
1080, and a window opens, saves and refreshes the screen behind it.

#### Package 9. Overview (M)

**Figma.** `04 Overview / Default` (`25:16`), `Dark` (`25:555`), `Empty`
(`25:358`), `Context menu`, `Recent menu`, `Sidebar tooltip`.

**Behaviour.** A greeting with the owner's name, one sentence about what is
overdue and waiting, four counts (Clients, Projects, Documents, Unread mail) that
open their screens, "Coming up" (Reminders and Calendar links, grouped by day with
the day at the left: Overdue, Today, a weekday), a "Suggestions" block ("Worked out
from your records. Nothing is saved until you add it."), and a right column with
Unread mail, Documents and Clients. An agent request waiting shows as a row with
Review. The Empty frame shows the mascot (package 10).

**Build.** `features/overview/` already has every card. Compare the frames with it
first and change only the layout and the grouping that differ. One thing to
fix in the data: a suggestion must never offer to invoice, because Juno does not
invoice (decision 9), so drop that suggestion kind or reword it.

**Done when.** Default, dark and empty match the frames.

#### Package 10. The mascot (M, partly needs you)

**State.** Parked. Two attempts were rejected: a hand-drawn set (`brand/mascot`,
delete it) and ten free CC0 outline candidates from Openclipart
(`brand/mascot-candidates`, contact sheet in `preview.html`, licences in
`SOURCES.md`), none of which was liked. Nothing is chosen, and the design still
uses the stand-in mark. The search found no stand-alone character doing work in
outline style and no friendly monster, so the next attempt needs a different
source or a commissioned drawing. **you** pick the direction and the artwork.

**Behaviour.** One outline character, called Juno, drawn with `currentColor`
strokes so it themes. It replaces the logo mark. Its head alone is the app icon
and tab icon (readable at 16px). Full-body poses fill empty states (no clients,
no mail, no notes, nothing found, inbox zero), loading and syncing, the lock
screen (sleeping), the splash, the first run and the update dialog.

**Build.** Put the chosen files in `brand/mascot/` with `SOURCES.md` and the
licence text. Update `brand/BRAND.md` (name, character, use rules, where it may
and may not appear) and `brand/logo/`. Run `npm run icons` for the application
icon and installer art. Place the poses in `components/EmptyState.tsx`,
`components/LoadingScreen.tsx` and `components/LockScreen.tsx`, and draw the
splash and setup windows with it. No raster in the renderer bundle, no text inside
the SVGs, animation only for loading and only with `prefers-reduced-motion` honoured
(already global in `global.css`).

**Done when.** Every empty state in the design list above shows a pose, the icon
reads at 16px in both themes, and `SOURCES.md` names a licence that allows this
use for every file.

#### Package 11. Native Windows integration (M)

**Behaviour.** Windows toast notifications with action buttons (a due reminder
has Complete and Snooze, an agent request has Review), a tray icon with a menu
(Open Juno, New note once package 4 exists, Quit) and a setting for whether
closing the window keeps Juno running (decision 49 already runs it in the
background), a taskbar overlay badge with the number of requests waiting, a global
shortcut for a new note (off by default, set in Settings), and native file dialogs
everywhere a file is picked. Nothing here sends anything off the machine.

**Build.** `electron/main/notifications.ts` and `services/notifications.ts` exist
(check what they cover), add `electron/main/tray.ts`. A new settings page under
General called "Notifications and tray" with an entry in the search. Windows only:
guard the rest with a platform check, do not stub a Mac or Linux version.

**Done when.** Each action works from a real toast on Windows, and the badge
clears when the last request is answered.

#### Package 12. Automations get a home (S to M, needs decision 6)

The app has automations (`features/agent/AutomationList.tsx`, `AutomationForm.tsx`,
`services/automations.ts`) and the design no longer shows them. Once the home is
decided and drawn, move the screen there and remove it from the Agent screen. The
rules in `.claude/rules/mcp.md` section 5 stand: a recording of service calls, no
second engine, a step that parks stops the run.

### 8.3 Layout rules the design learned the hard way

These are faults found in the Figma file and fixed. The same faults are easy to
build into the app, so check for them in every screen.

- **A row that holds an input sizes to its content.** The mail form's To and
  Subject rows were fixed at 60px while the field is 64px, so the box was cut
  off. Rows hug, and an action beside an input aligns to the bottom of the box,
  not to the label.
- **A grid that should fill the window is told to fill it.** The month view
  stopped short and left blank white. Parent and rows fill, not a fixed height.
- **An empty cell has a height.** An empty all-day cell hugged to a default 100px
  and made the row 102px tall. Give empty cells the row height.
- **No empty header block.** Three screens kept a 100px header whose title had
  moved to the title bar. Remove the block, do not hide its text.
- **A clip hides a mistake.** Anything with `overflow: hidden` that is smaller
  than its content looks fine and is wrong. Settings pages that are longer than
  the window scroll and show a scroll thumb. Nothing else is cut.
- **A label that wraps pushes its neighbour.** Event titles in a one-hour block,
  a button label in a 56px row. Shorten the copy or let the row grow.
- **Icons scale with their size.** An icon drawn on a 24 grid must scale when
  used at 14, 16 or 18, so use an SVG with a `viewBox` and a size, never a fixed
  pixel drawing.

### 8.5 Open design work in Figma

Not code, but the packages above wait on some of it.

- **Draw** the document-from-template window, the Sign flow (place the stamp, sign
  digitally, the audit page), the Notes empty state, and a home for automations.
- **Place the mascot** (package 10) in the logo frames on the Stylesheet page, the
  splash, setup, lock and every empty state, once one is chosen.
- **Settings content that is design only.** `19 Settings / Documents` (`34:4424`)
  shows a documents folder and "Keep every version", which the app has no setting
  for (checked in `src/` and `electron/`), under the page `Signature image`. Either build them (a documents
  folder setting and a keep-versions setting, with the services) or remove them
  from the frame. `19 Settings / Security and data` (`34:4475`) draws Lock, Backup
  and the agent log purge on one page where the app has Lock and Backup as
  separate pages. Redraw to match `features/settings/pages.ts`.
- **Small overflows left in components,** all a few pixels: Stat Card (91 tall in
  an 88px slot), Notice (45 in 40), Suggestion Bar (59 in 56), Toggle (43 in 40),
  Setting Row (64 in 56), Request Card (183 in 160). Make them hug.
- **Component upkeep.** After the Settings rebuild the Components page has the
  new sets (Settings Nav Row, Settings Search, Editor Tool, Block Menu, Block
  Menu Row). Re-stack the sections with an 80px gap and check for overlaps.
- **Frame names** for the Settings row are the old page names (`Your business`,
  `Documents`, `MCP`, `Agent`). Rename them to the page each now shows (Your
  details, Signature image, What an agent can do, Permissions).

### 8.6 What is already built and matches the design

So nobody redoes it. The settings window already has the nav the design now shows
(search, groups, pages under a guide line, a breadcrumb): `features/settings/
SettingsNav.tsx` and `pages.ts`. The icon rail is a fixed 56px strip of icons with
tooltips and no other state, which is final. Context for these two is in
`.claude/rules/styling.md` sections 5b and 5c.
