# Todo

Things that are deliberately not done yet, and what unblocks each. Anything with
a **you** tag needs Nathan rather than a session.

---

## 1. One example document template, and your own real ones

Phase 1 ships five **invented** contract templates (`nda`,
`development_agreement`, `hosting_agreement`, `project_scope`, `addendum` in
`electron/main/services/document-templates-seed.ts`) so the machinery could be
built and tested. They are structurally plausible and legally worthless.

**Decided.** New installs stop getting them, and one example ships in their place.

- The example is a single document template that shows every part of the
  document editor: every kind of placeholder, an input the template asks for,
  pages, headings, a table, and the signature block. Written in Dutch with "u",
  by writing.md section 1, and native rather than translated.
- It is seeded **only on a first install**, into an empty database, and after
  that it is an ordinary template the owner can edit or delete. An upgrade
  never adds it to an existing install and never brings it back.
- **Existing installs keep the five exactly as they are.** They are simply no
  longer seeded: a new install gets the example and nothing else, and an
  upgrade neither adds, hides nor deletes anything. No row is removed, so the
  hide-don't-delete rule (data.md section 9) is not touched.

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

Until then an external agent does the same work. Open Agent, copy the
configuration, paste it into Claude Desktop or Claude Code. That also answers
phase 6's done-when in PLAN.md.

## 3. Smaller things

Decided and ready to build, roughly smallest first.

- **Sent messages show in the reader only after the Sent folder is synced.**
  Until then the outbox is the record. Showing outbox rows inside a thread
  would close the gap.
- **The composer is plain text.** A small fixed toolbar (bold, a link, a list)
  is the phase 4 promise not yet kept.
- **Unsent drafts are not merged into the Drafts folder.** Juno's own drafts
  live in the outbox and the server's live in its Drafts folder, and the
  Drafts view says so in a line pointing at the outbox rather than showing
  both. Merging them means reconciling two row types through one list, its
  selection and its menu.
- **Purging a removed mail account.** Removing an account forgets its password
  and soft-deletes the row; its messages and attachments stay on disk until a
  purge exists. That purge is a confirmed action, never an MCP tool.

Needs your hands rather than code:

- **No real mail server has been used yet.** Reading and sending are proven
  against a mailbox and a transport held in memory.
- **No other calendar has read a Juno .ics file yet.** Export a month, open
  it in Google Calendar or Outlook, and check the moved occurrence of a
  recurring event after the October change. Then import an Outlook export the
  other way; its Windows zone names are handled through the file's VTIMEZONE,
  which is tested against a hand-written one and not yet a real one.
- **No third-party MCP client has connected yet.** The smoke run starts the
  real bridge and speaks MCP to it, but Claude Desktop and Claude Code have
  not. Try both, and check that a tool list cached while Juno was closed
  recovers when it opens.

Not tasks, written down so nobody builds them by accident:

- **Nothing files mail on its own except the owner's mailbox rules** (5b).
  An agent or an automation still cannot: filing is side-effectful, so it is
  excluded from anything unattended by the same rule that keeps sending out of
  an automation.
- **An automation cannot pass one step's result to the next.** Anything that
  needs the output of a previous step is a job for an agent, which can read and
  then decide, rather than for a recording.

## 4. Mail template editor

Three pieces of work, in this order, because the second changes the model the
third and the example build on. Read docs/editors.md section 2 and decisions
36 and 37 first; every rule there still holds. Each piece is its own set of
commits, and each keeps the four checks green: `npm run check`,
`JUNO_SMOKE_DEMO=1 JUNO_SMOKE_FRONT=1 npm run smoke`, both themes looked at, and
the copy sweep in writing.md section 7.

### 4a. A tool for every element a mail client renders, grouped like Figma's

**What it does.** The floating toolbar
(`src/features/templates/mail/canvas/CanvasToolbar.tsx`) becomes groups. Each
group is one button with a chevron beside it, and the chevron opens a menu of
the group's elements, each with its name and its key, the way Figma's frame
tool opens Frame, Section and Slice. The button adds the group's last-used
element (remembered per machine in localStorage, like autosave). What is added
is that HTML element, so the layers and the code view name it for what it is,
and the tag can be changed afterwards in the design panel within its group,
the way a heading's level is changed now.

| Group | Elements | Notes |
| --- | --- | --- |
| **Containers** | section, div, header, footer, main, article, aside, nav | Each lays out what is in it the way a section does now: flow, gap, padding, alignment, breakpoints. Each can hold blocks and other containers |
| **Text** | h1 to h6, p, blockquote, pre, address, span, and a list (ul or ol with li) | The element only. Bold, italic, underline and links stay inside the text, on the format bar |
| **Columns** | a table laid out for mail: `table role="presentation"`, rows, cells | The one layout that stays side by side in Outlook on Windows ("The Outlook problem" in docs/editors.md). Cells hold blocks |
| **Media** | img, and img inside a link | Video, audio and embeds play in no client that matters. The menu says so in one line instead of offering them: a video is a picture with an on-click action to where it plays |
| **Other** | hr, and a declared input | As they are now |

**The model change, which is the bulk of it.**

- Today `MailLayout.sections` is one level: sections hold blocks, and a
  section compiles to a `div`. Containers nest, so the model becomes a tree: a
  container holds an ordered list of children, each a container, a text
  element, a table or a leaf block. Keep ids stable; breakpoints key their
  overrides by id and must keep working (`breakpoints.ts`,
  `parseBreakpoints` and `breakpointRules` in `mail-layout.ts`).
- Give every element a `tag` field, checked against its group's list in the
  parser the way `toColor` checks a colour. A text element's `kind` stays
  "text" or "heading"; the tag says which one it is written as.
- **A schema version bump, not a migration.** The layout is JSON in
  `layout_json`, so there is no Drizzle migration, but `MailLayout.version`
  goes to 2 and `normaliseLayout` reads a version 1 layout into the tree:
  each section becomes a `section` container holding its blocks. Every
  template saved today must open unchanged, and a test must prove it.
- The compiler writes each element with its own tag, keeps the `data-juno-*`
  markers, and `layoutFromHtml` reads them back, nested. The code view round
  trip tests in `mail-layout.test.ts` must pass for nested containers and for
  a table.
- The layers panel (`LayerTree.tsx`) becomes a real tree: expand and collapse
  at every level, drag into and out of containers, Alt and an arrow still move
  one place. The canvas drop targets follow.
- `sizing.ts` works per parent rather than per section, since any container is
  a parent now.

**Files you will touch.** `electron/shared/types.ts`,
`electron/main/services/mail-layout.ts` and its test, `canvas-actions.ts`,
`breakpoints.ts`, `sizing.ts`, `CanvasView.tsx`, `LayerTree.tsx`,
`DesignPanel.tsx`, `CanvasToolbar.tsx`, `shortcuts.ts` (keys per element, and
the list the toolbar shows), `MailTemplateEditor.tsx` (insert, paste,
duplicate), the MCP layout description in `electron/main/mcp/mail-outbox.ts`,
and docs/editors.md.

**Decided.** A section is written as `<section>` in the sent HTML, with
`display:block` on it because some older clients style unknown block elements
oddly. That includes every section in a version 1 layout, which compiles to a
`div` today. A `div` added from the Containers group stays a `div`. Every other
container is written as its own tag. Write this down in docs/editors.md.

**Done when.** A version 1 layout loads and sends the same body, except that
each section is now a `<section>` with `display:block`, which a test checks.
Every element in the table can be added from the toolbar and from its key,
changed within its group, nested, dragged in the layers, hidden at a
breakpoint, converted to HTML, and read back from the code view. The smoke walk
adds one element of each group and nests a text block in a header.

### 4b. Actions instead of a button block

**What it does.** The button leaves the toolbar. Every element gets an
**Actions** section in the design panel, after Effects, listing actions as rows
like the effects: a trigger, what it does, an eye and a minus.

| Trigger | What it can do | Compiles to | Where it works |
| --- | --- | --- | --- |
| **On click** | Open a link (https), start a mail (mailto), call (tel) | The element wrapped in an `<a>`, or an `<a>` itself for inline text | Every client |
| **On hover** | Change the fill, text colour, underline or opacity | A `:hover` rule in the head, next to the breakpoints, `!important` like them | Apple Mail, iOS, Outlook on the web. Not Gmail, not Outlook on Windows; the panel says so on the row |

Nothing else: focus, scroll and timed triggers need a script.

- A button becomes a text element with a fill, a radius and an on-click
  action. Existing `button` blocks keep loading and compiling, the way
  dividers and spacers do now; they are simply not offered.
- `safeHref` already refuses anything but https and mailto; add tel there,
  with a test, and refuse everything else as it does now.
- The hover rules come out of the same place as the breakpoints
  (`breakpointRules` in `mail-layout.ts`), so the class names and the
  sanitising are shared, and a rule can never contain an angle bracket.
- A link on a whole block must not wrap block elements in a way clients
  break: an `<a>` around a `div` is valid HTML5 and Gmail keeps it, but test it
  in the preview and in the Outlook note.

**No custom JavaScript.** Not a choice Juno gets to make: every mail client
removes `<script>` and every `on*` handler before the reader sees the message,
Gmail and Outlook drop the whole element, and mail with scripts in it scores
as spam. `sanitiseMarkup` strips them for that reason. The two triggers above
are the whole of what an email can do when somebody interacts with it. Do not
add a script field, and do not let a code block carry one.

**Done when.** Tests: an on-click action compiles to a link and reads back from
the code view; a hover action writes one rule with the element's class; tel,
mailto and https pass and javascript, data and http do not. The smoke walk adds
an on-click action to a text block and checks the sent HTML has the link.

### 4c. Stop seeding the shipped mail templates, and ship one example on first install

**Decided.**

- The four shipped mail templates (`contract_cover`, `project_kickoff`,
  `invoice_due`, `hosting_renewal` in
  `electron/main/services/mail-templates-seed.ts`) are **no longer seeded**. A
  new install does not get them. An existing install keeps them exactly as
  they are, and an upgrade neither hides nor deletes them, so no reference
  breaks and the seeding rules (data.md section 9) are not touched.
- Nothing in the code may point at `contract_cover` by key any more, because
  a new install will not have it. The two callers went when sending a document
  became an attachment with an empty body.
- **One example ships in their place, only on a first install.** A single
  canvas template that uses every part of the editor, so opening it teaches
  the canvas. It is seeded into an empty database and never added by an
  upgrade. After that it is the owner's to edit or delete. Written in Dutch,
  "u", by writing.md section 1, and native, not translated. `reviewedAt` stays
  null like every shipped text.

What the example has to show, one of each:

- A header container with a logo picture (an https address) and a linked
  Google font on the heading.
- Rich text with bold, italic, a link and a placeholder (`{{client.firstName}}`).
- A picture input the template asks for, in the Asks view.
- Two columns across that stack into one at a Phone breakpoint, and a Columns
  table for comparison.
- A divider: an empty section with a height and a bottom stroke.
- A gradient fill, a drop shadow, rounded corners, a colour with opacity.
- A text element with an on-click action, styled as a button, with a hover
  action.
- A code block.
- A footer container with the business details, which the house frame used to
  add and a canvas no longer does (decision 37).

**Done when.** A test seeds the old version, runs the new seed, and checks
the four are still there and unchanged and no example was added to an install
that already had data. A second test seeds an empty database and finds the
example with a canvas and none of the four. The smoke walk opens the example, and its
preview renders with no missing values against the demo client. Send the
example to yourself once and read it in Gmail on a phone and in Outlook on
Windows, and write down what each shows.

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
