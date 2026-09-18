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

## 3. Sync a real mail account and report back - **you**

Phase 3 has never seen a real IMAP server. Add one account under Settings,
press Sync now, and note anything that looks wrong: a folder missing, a body
that will not fetch, a thread split in two, a date off by a few hours. The
questions the run is meant to answer are at the end of the session entry in
`BUILD-LOG.md`.

Nothing is written to the server, so the worst a bug can do is show something
incorrectly on this machine.

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
