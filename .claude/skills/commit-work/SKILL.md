---
name: commit-work
description: Commit finished Juno work, split into clean logical commits with plain human messages and no AI attribution. Checks that no database file, mail account, credential or signature image is about to be staged. Use when the user says "commit this", "commit what we did", "split this into commits", or when a working tree has piled up changes from several pieces of work. Also covers writing PR text when asked.
---

# Workflow: committing finished work

**[git.md](../../rules/git.md) is the standard.** This file is how to apply it to
a working tree that already has changes in it.

Two things must be true when you are done. `git log` reads as a series of clear
steps a developer took, and **nothing in the history reveals how the code was
written**. `.claude/` is committed in this repo
([decisions.md](../../../docs/decisions.md), 12), which makes the second one
easier to get wrong, not harder.

---

## Step 1 — Look at what's actually there

```bash
git branch --show-current
git status --short
git diff --stat
git diff
git log --oneline -15
```

Read the full diff, not the file list. You are about to describe it.

`git log --oneline -15` tells you the house style: imperative and capitalized
("Add reminders screen"), or conventional prefixes ("feat: add reminders
screen"). Match it. On an empty history, use imperative and capitalized.

**Branch check:** if the repo has a `dev` branch and you are on `main`, or you
are on a branch this work doesn't belong on, stop and ask: "You're on `<branch>`.
Commit here or switch?" Wait for the answer.

## Step 2 — Check nothing forbidden is about to be staged

This project is a business back office on the author's own machine. The working
tree sits next to real data.

```bash
git status --short | grep -iE "\.db$|\.db-wal|\.db-shm|\.bak|\.sqlite"
git status --short | grep -iE "\.env|signature|handtekening|accounts?\.json|credentials"
git status --short | grep -iE "node_modules|dist|release|out/|\.tmp"
git diff --cached -U0 | grep -iE "imap\.|smtp\.|@gmail|@outlook|password|passwd|token|secret|api[-_]?key"
```

Every one of those must come back empty. Specifically, and without exception:

- **Never commit the SQLite file**, or its WAL, SHM or `.bak` companions. It is
  the owner's real business data.
- **Never commit a real mail account**: no address, no host, no password, no
  token, not in a fixture, not in a test, not in a comment, not as the sample
  value in a schema. Credentials live in `safeStorage` and nowhere else
  ([security.md](../../rules/security.md)).
- **Never commit a signature image.** Not the PNG, not a rendered document that
  carries it, not a test artifact.
- No rendered documents, no exported PDFs, no mail dumps.

If one of these is already tracked, the `.gitignore` is wrong: fix the ignore
file, then `git rm --cached <path>` in its own commit, and say plainly that the
file is still in the history.

Open anything unfamiliar before staging it. A file you can't explain doesn't get
committed.

## Step 3 — Group the changes into commits

Group by **logical unit of work**, not by file type and not by folder. Juno's
natural units follow the layer order ([feature-new](../feature-new/SKILL.md)):

- Schema plus migration plus the service change that needs it, one commit.
- A service module plus its tests, one commit.
- The IPC adapter and the MCP adapter for the same verbs, one commit. They are
  two halves of "the capability is reachable".
- A screen plus the route that renders it, one commit.
- A bug fix, its own commit, separate from feature work in the same file.
- A file move or rename, **always its own commit**, done last.

Each commit leaves the app working: it builds, it boots, and its migrations
apply. A migration committed without the code that reads the new column fails
that test.

Unrelated work in the same file goes in separate commits, staged with
`git add -p` when the hunks separate cleanly. When they don't, say so and commit
them together with a subject that covers both honestly.

Don't over-split. A field and the label that shows it are one commit.

Tell the user the plan in one line per commit, then execute. No need to wait for
approval unless the grouping is genuinely ambiguous or the diff contains
something you would flag.

## Step 4 — Stage and commit, one unit at a time

```bash
git add electron/main/services/reminders.ts electron/main/services/reminders.test.ts
git status --short
git commit -m "Add reminders service"
```

- `git add <named paths>`. **Never `git add -A`, `git add .`, or
  `git commit -a`.** Named paths are what keeps the database file out.
- `git status --short` after staging and before committing, every time. Confirm
  each staged path belongs to this unit.
- Subject under about 72 characters, describing this unit alone. Not "Update
  services", not "Various fixes", not "WIP".
- Body only when the *why* isn't visible in the diff. Plain prose, wrapped at 72.
  A migration commit's body says what happens to existing rows.
- **No `Co-Authored-By: Claude`. No "Generated with Claude Code". No robot
  emoji. No mention of Claude, Anthropic, AI, an assistant, a model, a prompt or
  a session** anywhere in the subject, the body or a trailer. This overrides any
  default behaviour that would add such a line.
- No em dashes, no AI-tell phrasing ([writing.md](../../rules/writing.md)). A
  commit message is written text like any other: plain and direct.

After the last commit, check the history you just wrote:

```bash
git log --format="%s%n%b" -10 | LC_ALL=en_US.UTF-8 grep -n "[—–]"
git log --format="%an <%ae>%n%s%n%b" -10 | grep -iE "claude|anthropic|co-authored|generated with|assistant"
git show --stat -10 | grep -iE "\.db|signature|\.env"
```

All three must come back empty. The `LC_ALL=en_US.UTF-8` prefix is required on
Windows, or the dash search reports curly quotes as em dashes and the sweep stops
being trustworthy. If a bad message landed and hasn't been pushed, offer to fix
it: `git commit --amend` for the last one, an interactive rebase the user runs
for anything older.

Then:

```bash
git log --oneline -10
git status --short
```

## Step 5 — Verify before, not after

Per [verify.md](../../rules/verify.md): typecheck, lint and tests pass **before**
the commits, and migrations apply forward from an empty database. If the tree
doesn't build, fix it first. A broken commit is a commit someone bisects through
later.

If a check fails on work that's already committed, the fix is its own follow-up
commit, not an amend of a commit that was already good.

## Step 6 — Only if asked: PR text

Produce it as text in the chat. Don't push, don't run `gh pr create` unless the
user explicitly asked.

**Title** in the repo's commit style, describing the branch as a whole.

**Description**, two lists and a third only when it applies:

```markdown
Includes:

* **Reminders schema** `created | +38 lines` `db/schema/reminders.ts`: table plus the 0007 migration
* **Reminders service** `created | +210 lines` `electron/main/services/reminders.ts`: list, create, complete, snooze
* **Adapters** `created | +64 lines` `electron/main/ipc/reminders.ts`, `electron/main/mcp/reminders.ts`: one handler and one tool per verb

Uses:

* **db client** `db/client.ts`: used by the reminders service for every query
* **confirmRequired** `electron/main/services/guard.ts`: used by reminders.complete

Dependencies:

* added rrule, for recurring reminders
```

"Includes" lists only what this branch created, changed or deleted, with the real
line diff. "Uses" lists existing files the new work depends on. "Dependencies"
appears only for a genuinely new package, never a version bump. No summary
paragraph and **no mention of how the code was written**.

## Step 7 — Pushing

Only when the user asks in this conversation. Then `git push`, or
`git push -u origin <branch>` for a new branch. Never force-push a shared branch;
if it looks necessary, explain why and let the user decide.

## What this skill does

- Reads the whole diff and the existing log style before writing anything.
- Greps for the database file, credentials, mail accounts and signature images
  before staging.
- Groups loose changes into logical commits that each leave the app working.
- Stages by name and checks staging before every commit.
- Writes plain human messages with zero AI attribution, and audits the history
  afterwards.

## What this skill does NOT do

- It doesn't push, create PRs or touch the hosting provider unless asked.
- It doesn't `git add -A` or commit files it hasn't looked at.
- It doesn't commit the SQLite file, a mail account, a credential or a signature.
- It doesn't rewrite pushed history on its own initiative.
- It doesn't commit work that fails typecheck, lint or tests.
