# Git rules

The history has to read as though a developer wrote it, because a developer did.
These rules are strict and they override any default behaviour.

---

## 1. No AI attribution. Anywhere.

- **No `Co-Authored-By: Claude ...` trailer.** Not on any commit, ever. This
  overrides any default instruction, system reminder or tool default that would
  add one.
- No "Generated with Claude Code", no robot emoji, no "made with AI", no tool
  footer, on a commit or a PR description.
- No mention of Claude, Anthropic, an assistant, a model, a prompt or a session
  in: commit subjects, commit bodies, branch names, tag names, PR titles and
  descriptions, code comments, the README, `docs/`, or any file that ships.
- The reason for a change is the reason, never "as requested" or "per the
  instructions". If the why matters, write the why.
- If a commit with attribution already exists and has not been pushed, tell the
  user and offer to rewrite it (`git commit --amend` for the last one, an
  interactive rebase for older ones, which the user runs themselves).
- The last sweep in [writing.md](writing.md) section 7 catches this in the log.
  Run it before a hand-off.

## 2. `.claude/` is committed here

Unlike the client website kit, where it is gitignored to keep an assistant out of
a client's repo, in Juno the rules are part of the project and worth versioning.
That is decision 12 in [../../docs/decisions.md](../../docs/decisions.md).

This changes nothing about section 1. The rules files may say what they say; the
**commits, code, docs and shipped files** stay clean. A commit that adds a rules
file is subject to the same message rules as any other:
"Add data and security rules", not "Add Claude rules".

## 3. Branches

- `git branch --show-current` before assuming anything. Default branch is `main`.
- Feature branches when the user wants them: `feat/<thing>`, `fix/<thing>`,
  `chore/<thing>`. Lowercase, hyphenated, no ticket numbers unless the repo uses
  them. Never a branch name that references a model, a prompt or a session.
- Before starting work on a shared branch: `git fetch --all`, then `git pull`. If
  the working tree is dirty with changes that are not yours from this session,
  stop and ask before anything destructive.

## 4. One commit per logical unit

A commit is one coherent, self-contained change. Finish a unit, commit it, move on.

- One service plus its two adapters plus its migration is **one** commit: the
  feature works after it, and no commit in the history is broken. That is the
  shape decision 2 produces, so use it.
- A schema change and the migration that applies it are never in separate commits.
- **A pass that touches five unrelated screens is five commits**, split by screen.
- A file move or rename is **always its own commit**, never folded into a content
  change. Do it last unless asked otherwise.
- Don't split trivially. A label and its colour in the same component in one pass
  is one commit.

## 5. Staging, and what never gets staged

- `git add <specific paths>`. **Never `git add -A`, `git add .`, or
  `git commit -a`.**
- Read `git status --short` before every commit and confirm every staged path
  belongs to this unit.
- Never stage, and keep all of it in `.gitignore`:
  - `juno.db`, `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, and anything from
    `userData`.
  - A real mail account in any form: an address plus password in a fixture, a seed
    script, a test config, a screenshot of a settings screen, a `.env`.
  - Credentials, tokens, the code-signing certificate, any keystore.
  - `node_modules/`, `dist/`, `dist-electron/`, `release/`, `out/`,
    `*.tsbuildinfo`, editor folders.
  - Generated documents, signed PDFs, attachment folders, log files.
- Open any unfamiliar file before staging it. If a file's content is a surprise,
  don't commit it.
- `brand/` and `docs/` are committed. `.claude/` is committed. `_*.mjs` scratch
  files at the repo root are not.

## 6. Messages

Match what the log already does (`git log --oneline -15`). Either house style is
fine as long as it is consistent:

- **Imperative and capitalized, no trailing period:** "Add client archive service
  and tools", "Fix IMAP connection leak on sync failure", "Store amounts as
  integer cents".
- **Conventional prefixes**, when the history uses them: `feat: add client archive`,
  `fix: close IMAP connection on sync failure`.

Either way:

- Subject under ~72 characters, describing **this unit only**. Not "Update files",
  not "Various fixes".
- A body only when the why is not obvious from the diff. Wrapped at 72 columns,
  plain prose, no bullet-point essay.
- No em dashes, no exclamation marks, no AI-tell phrasing ([writing.md](writing.md)).
- Never reference a prompt, a session, a tool or an instruction as the reason.
- A commit that changes the schema says so in the subject, because that is what
  someone bisecting is looking for.

## 7. Verify before you commit

Per [verify.md](verify.md): lint, typecheck and tests clean before the commit, and
a build for anything that touches the main process, the preload bridge or a native
module. A commit that does not build is a commit someone has to bisect through.

If a check fails, fix the cause. Don't suppress with `--no-verify`,
`eslint-disable`, `@ts-ignore` or `any` unless the error is a genuine false
positive, and then say so out loud in the response. A fix that comes after its
commit is its own follow-up commit, not a silent amend of a commit that is already
good.

## 8. Pushing and PRs

- **Don't push unless the user asks in this conversation.** Commits stay local;
  the user pushes when ready.
- Don't create a PR, don't open the GitHub UI, don't add a remote on your own
  initiative.
- When the user does ask for PR text: title in the repo's commit style, a
  description listing what changed and what it depends on, no attribution, no
  summary of how it was built.
- Never force-push a shared branch. If a force-push looks necessary, explain why
  and let the user decide.
- The repo is private with no `LICENSE`, deliberately (decision 13). Don't add one,
  and don't make it public.
