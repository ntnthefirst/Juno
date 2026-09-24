# Todo

Things that are deliberately not done yet, and what unblocks each. Anything with
a **you** tag needs Nathan rather than a session.

---

## 1. Decide the licence — **you**

The repository exists (`github.com/ntnthefirst/Juno`), `publish:` in
`electron-builder.yml` points at it with `releaseType: draft`, and the
`electron-updater` wiring is in. What is left is the licence: the repo is
currently all rights reserved by default, which is the right holding position
until decided otherwise. See decision 13. The question that settles it: should
a company be able to take Juno, host it, and sell it back?

## 2. Replace the placeholder legal texts with real ones — **you**

Phase 1 ships with **invented** contract templates so the machinery can be built
and tested. They are structurally plausible and legally worthless.

Every seeded template carries `reviewedAt: null`, and the app treats that as a
first-class state:

- The template list marks them plainly as not reviewed.
- Generating from one stamps a visible specimen banner into the document.
- The signing screen refuses to treat an unreviewed template as final.

**What to do:** rewrite each template's body with your real text, then clear the
specimen flag on it. The placeholder syntax and the available fields are
documented in `docs/templates.md`.

**Do not send a document generated from an unreviewed template to a client.**
That is what the banner is for, and why it is on the page rather than in a
tooltip.

## 3. Decide what the in-app assistant runs on - **you**

Phase 6 is built except its assistant panel. Everything the panel would drive
is there: 99 tools, the approval gate, briefings and automations. What it needs
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

## 4. Smaller things

- **Auto-update tests.** Nothing exercises the updater, because there is no feed.
- **The MCP server itself.** The tool descriptors exist for every service, but
  nothing serves them over stdio yet. That is phase 6 in `PLAN.md`; the
  descriptors are written per feature so that phase is assembly, not archaeology.
- **`npm run test` runs under Electron's Node** because the host's Node 23.9 has
  no `StatementSync.setReturnArrays`. If the host Node moves past 24 this can go
  back to plain `vitest`.
- **Database encryption** is out of scope and would mean revisiting decision 18,
  since `node:sqlite` cannot do SQLCipher. The likely answer then is
  `@libsql/client`.
- **Purging a removed mail account.** Removing an account forgets its password
  and soft-deletes the row; its messages and attachments stay on disk until a
  purge exists. That purge is a confirmed action, never an MCP tool.
- **The reader frame has a fixed height** with a taller and shorter toggle,
  because a sandboxed frame cannot report its content height. A resize handle
  would be nicer.
- **Unsent drafts are not merged into the Drafts folder.** Juno's own drafts
  live in the outbox and the server's live in its Drafts folder, and the
  Drafts view says so in a line pointing at the outbox rather than showing
  both. Merging them means reconciling two row types through one list, its
  selection and its menu.
- **Nothing files mail on a schedule, and nothing should.** Filing is
  side-effectful, so it is excluded from anything unattended by the same rule
  that keeps sending out of an automation.
- **The composer is plain text.** A small fixed toolbar (bold, a link, a list)
  is the phase 4 promise not yet kept. Templates carry their own layout, so it
  matters least for the messages Juno writes on its own.
- **Sent messages show in the reader only after the Sent folder is synced.**
  Until then the outbox is the record. Showing outbox rows inside a thread
  would close the gap.
- **No other calendar has read a Juno .ics file yet.** Export a month, open
  it in Google Calendar or Outlook, and check the moved occurrence of a
  recurring event after the October change. Then import an Outlook export the
  other way; its Windows zone names are handled through the file's VTIMEZONE,
  which is tested against a hand-written one and not yet a real one.
- **No third-party MCP client has connected yet.** The smoke run starts the
  real bridge and speaks MCP to it, so the socket, the token and the wire are
  covered, but Claude Desktop and Claude Code have not. Try both, and check
  that a tool list cached while Juno was closed recovers when it opens.
- **The audit log has no purge.** It grows by one row per write. A year of
  ordinary use is a few thousand rows, so this is not urgent, but "keep the
  last N months" belongs next to the backup settings eventually.
- **An automation cannot pass one step's result to the next.** Steps are
  independent calls with fixed arguments. Anything that needs the output of a
  previous step is a job for an agent, which can read and then decide, rather
  than for a recording.
