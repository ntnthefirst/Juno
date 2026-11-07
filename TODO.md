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
- **No real Windows toast has been clicked yet.** Complete, Snooze and Review
  are tested in the service and the toast is built with those buttons, but a
  smoke run cannot press one. Leave one reminder due today and no others, wait
  for the summary (or clear `lastNotifiedOn` in settings.json), press Complete
  and Snooze a day on two of them, then make an agent request, wait a minute
  and press Review. Also lock Juno first and check the toast shows no names and
  has no buttons. Same page: the tray menu (Open, New note, Quit), the number
  on the taskbar button clearing with the last request, and the Ctrl+Alt+N
  shortcut from another program, including the message when another program
  already owns the combination. Settings > General > Notifications and tray.
- **No mailbox rule has run against a real server yet.** The rules (Settings >
  Mail accounts > an account) are proven against a mailbox held in memory, which
  never disagrees with a real server about what a move or a flag does. Use a
  spare account first, not your working one. Connect it and let the first sync
  finish, and check that none of the mail already there is touched. Write a rule
  for your own address that marks read, flags and moves to a folder, send
  yourself two messages, sync, and check the webmail shows the read mark, the
  flag and the move as well as Juno does, and that the history on the account
  page names the rule for each action. Write a rule whose folder you delete on
  the server, send one more message, and check the failure is listed once with
  its reason and not tried again at the next sync. Note which provider you used,
  and whether it answered the move with the new UID or only at the next sync.

## 4. Not tasks

Written down so nobody builds them by accident.

- **Nothing files mail on its own except the owner's mailbox rules**
  (decision 64). An agent or an automation still cannot: filing is
  side-effectful, so it is excluded from anything unattended by the same rule
  that keeps sending out of an automation, and an agent can only ask for a rule
  through the approval gate.
- **An automation cannot pass one step's result to the next.** Anything that
  needs the output of a previous step is a job for an agent, which can read and
  then decide, rather than for a recording.

## 5. Mail: greetings for every message

Greetings and sign-offs became intros and outros in the composer, and are
built (decision 55), following the design instead of the static-text plan that
was written here before. The service is `services/mail-blocks.ts`, the screens
are in `src/features/mail/blocks/`. The unfinished branch `wip/mail-phrases`
is kept as a reference only: its model differs and it is not to be merged.

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

**The design is the reference for values** (decision 53). The tokens already match
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
A sensible order is 8.2 package 5, then 7, 8, then 9.

### 8.1 Decisions to take first - **you**

Each one is written into `docs/decisions.md` (next free number is 63) in the same commit as
the code that depends on it.

7. **Which wins, the tokens or the design.** Taken: the design (decision 53).

### 8.2 Packages

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
  digitally, the audit page), the Notes empty state (the screen uses the shared empty state until it is drawn), and a home for automations.
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
