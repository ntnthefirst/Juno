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
