# Todo

Things that are deliberately not done yet, and what unblocks each. Anything with
a **you** tag needs Nathan rather than a session.

---

## 1. Create the repository, then wire auto-update — **you**

`electron-builder.yml` has no `publish` block on purpose. An installed build that
points at the wrong update feed is worse than one that never checks, so the
updater stays off until there is a real repository behind it.

**What to do:** create the repository (its own GitHub organisation, per the
earlier decision, so the project outlives whichever business is current), then
say so in a session.

**What happens then, in one pass:**

- Add `publish:` to `electron-builder.yml` pointing at the repo.
- Add `electron-updater` wiring in the main process: check a few seconds after
  launch and every six hours, download in the background, and grow a "restart to
  update" affordance rather than restarting on its own.
- Decide the licence. The repo is currently all rights reserved by default, which
  is the right holding position. See decision 13.
- Note that the repository is private to start with, and that the update feed
  needs to be reachable without a token baked into the installer.

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

## 3. Run mail against a real account, both ways - **you**

Phases 3 and 4 have never seen a real IMAP or SMTP server. Add one account
under Settings with both servers, press Sync now, then send one message to
yourself from the composer. Note anything that looks wrong: a folder missing, a
body that will not fetch, a thread split in two, a date off by a few hours, a
message that never arrives, a copy missing from Sent, or the house shell
looking broken in Outlook or on the phone. The questions the runs are meant to
answer are at the end of the two session entries in `BUILD-LOG.md`.

Deliverability is the other half: SPF, DKIM and DMARC on the real domains have
to align with the SMTP server the account uses, or the first client mail lands
in spam. That is DNS, not Bureau, and it is worth checking before a real
contract goes out this way.

The sync writes nothing to the server. The sender writes exactly two things:
the message, and a copy into Sent.

## 4. Decide what the in-app assistant runs on - **you**

Phase 6 is built except its assistant panel. Everything the panel would drive
is there: 99 tools, the approval gate, briefings and automations. What it needs
and nothing else does is a model, which means three answers from you.

- **Which provider**, and whether Bureau ever talks to one at all. PLAN.md is
  binding that the app opens, syncs and works with no key configured, so the
  panel is additive and absent by default.
- **Where the key lives.** `safeStorage`, like a mail password, by decision 6.
  Nothing about a key belongs in `.env` or the build.
- **What it may do unattended.** Nothing changes about the gate: an assistant
  is a caller like any other and its side-effectful calls park for approval.

Until then an external agent does the same work. Open Agent, copy the
configuration, paste it into Claude Desktop or Claude Code. That also answers
phase 6's done-when in PLAN.md.

## 5. Smaller things

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
- **The composer is plain text.** A small fixed toolbar (bold, a link, a list)
  is the phase 4 promise not yet kept. Templates carry their own layout, so it
  matters least for the messages Bureau writes on its own.
- **Sent messages show in the reader only after the Sent folder is synced.**
  Until then the outbox is the record. Showing outbox rows inside a thread
  would close the gap.
- **No other calendar has read a Bureau .ics file yet.** Export a month, open
  it in Google Calendar or Outlook, and check the moved occurrence of a
  recurring event after the October change. Then import an Outlook export the
  other way; its Windows zone names are handled through the file's VTIMEZONE,
  which is tested against a hand-written one and not yet a real one.
- **No third-party MCP client has connected yet.** The smoke run starts the
  real bridge and speaks MCP to it, so the socket, the token and the wire are
  covered, but Claude Desktop and Claude Code have not. Try both, and check
  that a tool list cached while Bureau was closed recovers when it opens.
- **The audit log has no purge.** It grows by one row per write. A year of
  ordinary use is a few thousand rows, so this is not urgent, but "keep the
  last N months" belongs next to the backup settings eventually.
- **An automation cannot pass one step's result to the next.** Steps are
  independent calls with fixed arguments. Anything that needs the output of a
  previous step is a job for an agent, which can read and then decide, rather
  than for a recording.
