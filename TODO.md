# Todo

What is genuinely still open. The first part is what only Nathan can do or
decide. The second is what code could still do. The third is what is left out
on purpose, so nobody builds it by accident.

The Figma screen passes are finished: every frame has been compared with the
app and what still differs is listed at the end, with the reason it was left.

---

## A. Only you can do these

### A1. Your own real document templates

Nothing that ships is fit to send to a client. A new install gets one example
document template and it is a specimen. An install that still has the five
invented templates from phase 1 (`nda`, `development_agreement`,
`hosting_agreement`, `project_scope`, `addendum`) keeps them as they are, and
they are specimens too.

Write your real contract templates in the app, from the example or from
nothing. The placeholder syntax and the fields are in `docs/templates.md`. **Do
not send a document generated from an unreviewed template to a client.** That
is what the banner is for.

### A2. Things that need a real account, client or program

Everything decided and buildable here is built. What is left needs your hands.

- **No real mail server has been used yet.** Reading and sending are proven
  against a mailbox and a transport held in memory, which never disagree with
  the RFCs. Expect the first real account to find something the fakes could not.
- **No other calendar has read a Juno .ics file yet.** Export a month, open
  it in Google Calendar or Outlook, and check the moved occurrence of a
  recurring event after the October change. Then import an Outlook export the
  other way; its Windows zone names are handled through the file's VTIMEZONE,
  which is tested against a hand-written one and not yet a real one.
- **Claude Desktop has not installed the extension yet.** Claude Code
  connects by address and works. Press Connect next to Claude Desktop under
  Settings > MCP > Connect a client, install, paste the token, and call a tool
  from a chat. Then close Juno, check the chat says Juno is not running, and
  open it again.
- **The example mail template has not been read in a real mail client yet.**
  Use it on a client whose address is yours (Mail, Styled mail, the example,
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
  Mail accounts > an account) are proven against a mailbox held in memory. Use a
  spare account first, not your working one. Connect it and let the first sync
  finish, and check that none of the mail already there is touched. Write a rule
  for your own address that marks read, flags and moves to a folder, send
  yourself two messages, sync, and check the webmail shows the read mark, the
  flag and the move as well as Juno does, and that the history on the account
  page names the rule for each action. Write a rule whose folder you delete on
  the server, send one more message, and check the failure is listed once with
  its reason and not tried again at the next sync. Note which provider you used,
  and whether it answered the move with the new UID or only at the next sync.
- **No real Word file has been imported yet.** The reader is tested against
  Mammoth's own output and a hand-built `.docx`. Import one of your contracts
  (Documents, Templates, Import Word file) and write down what comes across
  wrong.
- **No component has been used on a real contract yet.** Components are proven
  through the services and the smoke walk. Make your letterhead as one, place it in
  two templates, change it, and check both templates lose their review and a
  document made before the change still reads as it did.
- **The release itself.** `npm run smoke:packaged` and an installer on a clean
  machine, then the first published release, are yours to run.

### A3. Decisions that are yours

- **What the in-app assistant runs on (parked on purpose).** Phase 6 is built
  except its assistant panel. Everything it would drive is there: more than 200
  tools, the approval gate, briefings and automations. What it needs and nothing
  else does is a model, which means three answers. Which provider, and whether
  Juno ever talks to one at all (the app must open, sync and work with no key
  configured, so the panel is additive and absent by default). Where the key
  lives (`safeStorage`, like a mail password, decision 6, never `.env` or the
  build). What it may do unattended (nothing changes about the gate). Until then
  an external agent does the same work, connected under Settings > MCP.
- **itsme and eID signing.** A digital signature uses a .p12 or .pfx
  certificate imported under Settings > Documents > Digital signature. itsme
  needs an agreement and client credentials, and the eID key never leaves the
  card, so it needs a card reader driver and a native module. Needs an itsme or
  signing-provider agreement, or a decision to take on eID through PKCS#11
  (decision 38).
- **A trusted timestamp and a trust list for digital signatures.** The
  certificate is checked for a key, a validity period and its intended use. It is
  not checked against a trust list, and no timestamp authority is used, so a
  signature does not carry a trusted time and cannot be verified after the
  certificate expires. A timestamp authority is an outside service you would pick
  (and may pay for), and a trust list is a choice of which authorities to believe.
- **The mascot.** Parked. Two attempts were rejected: a hand-drawn set
  (`brand/mascot`, delete it) and ten free CC0 outline candidates from
  Openclipart (`brand/mascot-candidates`, contact sheet in `preview.html`,
  licences in `SOURCES.md`), none of which was liked. Nothing is chosen, and
  the design still uses the stand-in mark. The next attempt needs a different
  source or a commissioned drawing, and you pick the direction and the artwork.
  Once chosen: files in `brand/mascot/` with `SOURCES.md` and the licence text,
  `brand/BRAND.md` and `brand/logo/` updated, `npm run icons`, poses in
  `components/EmptyState.tsx`, `components/LoadingScreen.tsx` and
  `components/LockScreen.tsx`, and the splash and setup windows drawn with it.
  No raster in the renderer bundle, no text inside the SVGs, animation only for
  loading with `prefers-reduced-motion` honoured (already global).

### A4. Work in the Figma file

The file is read only from the code side. These are yours to draw or tidy.

- **Draw** the document-from-template window, the Sign flow (place the stamp,
  sign digitally, the audit page), the Notes empty state (the screen uses the
  shared empty state until it is drawn), and a home for automations (they are
  the Agent screen's third tab until then).
- **Place the mascot** in the logo frames, the splash, setup, lock and every
  empty state, once one is chosen.
- **Settle the title bar height.** The Title Bar component, the main window
  frames and the Settings frames draw 40px, and the Setup frames draw 44. The
  app draws 40 everywhere, so only Setup differs. Pick one and the other side
  follows.
- **Small overflows left in components,** all a few pixels: Stat Card (91 tall
  in an 88px slot), Notice (45 in 40), Suggestion Bar (59 in 56), Toggle (43 in
  40), Setting Row (64 in 56), Request Card (183 in 160). Make them hug.
- **Component upkeep.** Re-stack the Components page sections with an 80px gap
  and check for overlaps, since the Settings rebuild added sets (Settings Nav
  Row, Settings Search, Editor Tool, Block Menu, Block Menu Row).
- **Frame names** in the Settings row are the old page names (`Your business`,
  `Documents`, `MCP`, `Agent`). Rename them to the page each now shows (Your
  details, Signature image, What an agent can do, Permissions).

---

## B. What code could still do

Nothing here needs a decision, only time.

Nothing is open here.

---

## C. Not tasks

Written down so nobody builds them by accident.

- **Nothing files mail on its own except the owner's mailbox rules**
  (decision 64). An agent or an automation still cannot: filing is
  side-effectful, so it is excluded from anything unattended by the same rule
  that keeps sending out of an automation, and an agent can only ask for a rule
  through the approval gate.
- **No OCR for scans.** A PDF with no text layer cannot be matched to a
  document, only imported. OCR needs a large engine and language data shipped
  in the app, which is a decision about installer size and not a missing piece.
- **An automation cannot pass one step's result to the next.** Anything that
  needs the output of a previous step is a job for an agent, which can read and
  then decide, rather than for a recording.
- **The branch `wip/mail-phrases` is a reference only.** Its model of greetings
  differs from the intros and outros that were built (decision 55) and it is not
  to be merged.
- **A picture cannot be added to a page by an agent.** Only a person picks a
  file (decision 68).

### Where the app differs from the frames on purpose

Each of these was compared with its frame and kept, for the reason given.

- **Settings, setup, splash and lock.** The `Signature image` frame draws a
  switch for "Keep every version"; the app says every version is kept and has no
  control, since turning it off would delete history (decision 69). The Mail
  step of setup draws three fields and an Add account button; the app opens the
  account form in Settings instead, because an account needs SMTP and a
  connection test. The Security frame draws Lock, Backup and Agent log on one
  page under a nav that lists two; the app puts the agent log and Recent on the
  Backup page. The Help and about frame draws no About card, and the app keeps
  it (version and database path). Mail accounts rows keep Pause, Edit and Remove
  beside the status badge, which the frame omits.
- **Documents, Templates, Agent and Notes.** The viewer frame draws a pencil in
  the title bar for a generated document, which has no edit (a new version is the
  way), a viewer bar 125px tall (the app keeps 48) and the details as plain text
  (the app keeps the status, client and project as fields, and the template and
  timeline under them). The Templates frame has no search row and no Components
  button (the app keeps the search, and Components is in the title bar's more
  menu). The mail editor frame draws a reduced layers and design panel, where the
  editor has breakpoints, spacing, typography and a code view. The Notes list
  frame says "Previous 7 days" where the app uses the shared day split.
- **Mail.** The composer toolbar has an emoji button the frame does not draw.
  The intros and outros page keeps a second help line about a variable with no
  value, which the frame leaves out. The reader draws a message on a white sheet
  in dark, because the sanitised document carries its own colours
  (`mail-sanitise.ts`); the frame has no dark reading screen.
