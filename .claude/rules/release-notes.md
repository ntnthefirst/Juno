# Release notes rules

What every update says to the person using Juno, where it lives, and when it
gets written.

---

## 1. One source, one entry per version

`build/release-notes.md` is the only place release notes are written. It ships
inside the package, newest version first.

- **Settings, Release notes** shows the whole file. `services/release-notes.ts`
  reads it, and `updates.release_notes` hands the same text to an agent.
- **`scripts/release-notes.mjs`** copies the entry for the `package.json`
  version into `build/release-notes-latest.md` (ignored by git).
  `electron-builder.yml` puts that file in the release feed, which is how a
  running copy shows **what an update changes** before it installs it: in
  Settings, Updates, and as a line in the install window.
- The build fails when the version being built has no entry. That is on purpose.
- `release-notes.test.ts` fails when the top entry is not the `package.json`
  version, when an entry has no date, summary or items, and when the text breaks
  the writing rules.

## 2. When it is written

**Before the pull request from `dev` to `main` is opened**, in that pull request:

1. Work out the next version. A fix-only release is a patch, a release with new
   things is a minor, and a major is the owner's call.
2. Set `package.json` and `package-lock.json` to that version. `version.yml`
   otherwise numbers the release from the highest tag, and the notes would then
   name a version that is not the one built.
3. Add the entry at the top of `build/release-notes.md`, dated the day the pull
   request is opened. If the merge lands later, change the date.
4. Run `npm run check`. The test above is the review of the structure.

Source the entry from `git log <last tag>..dev`, read as what the person would
notice. A commit is not a note. Several commits are often one line, and a commit
that changes nothing visible is no line at all.

## 3. Shape

```
## 1.1.0
Released: 2026-12-02

One or two sentences saying what this version is about.

### New
- One plain sentence.

### Improvements
- One plain sentence.

### Fixes
- One plain sentence.
```

- The heading is the bare version, `1.1.0`, with no `v` and nothing after it.
- `Released:` is a date as `YYYY-MM-DD`, on the line after the heading.
- The summary is the first paragraph, one or two sentences. It is also what the
  install window shows, so it must stand alone.
- Sections come in this order and use these names only: **New**, **Improvements**,
  **Fixes**. Leave out one that is empty. An entry needs at least one.
- Each item is one sentence, starts with a capital, ends with a full stop, and
  stays under 140 characters.
- Order items by how many people notice them, not by when they were built.

## 4. What goes in

- Anything the person sees, does or gets differently: a screen, a button, a
  setting, a speed they can feel, a file format, something an agent can now do.
- A fix, said as what used to go wrong.
- A removed or moved feature, said as where it went.
- A change that needs the person to act, said first in its section and with the
  action named.

## 5. What stays out

- Code, files, functions, tables, migrations, tests, refactors, dependency bumps
  and build changes. Say nothing of them unless a person can notice the result.
- Documentation, rules and design-file changes.
- Commit subjects pasted as items.
- Version numbers of libraries, decision numbers and issue numbers.
- Anything about how the change was made or who made it. No mention of an
  assistant, a model or a prompt. The product name of a client Juno connects to,
  such as Claude Desktop, may appear because it is the name on the screen.

## 6. Voice

Plain English in the second person or no person at all. Say what changed for the
reader, in the present tense for a new thing ("Mail shows a status line") and in
the past tense for a fix ("used to show twice"). Short words. One idea per
sentence. Name the screen or the setting where the person finds it.

All of [writing.md](writing.md) applies: no em or en dashes, none of the stock
phrases in section 2 of that file, no exclamation marks, no emoji, no Title Case
on a heading beyond the three names above, straight quotes only.

Also avoid "now" as filler, "various", "several improvements", "bug fixes and
performance improvements", and "as requested". If the sentence would be true of
any release, it says nothing.

## 7. Example

Good:

```
## 1.1.0
Released: 2026-12-02

Reminders can repeat, and mail opens faster.

### New
- Reminders repeat on the days you choose, from the new Repeat field.

### Improvements
- A mailbox with thousands of messages opens in under a second.

### Fixes
- A reminder you snoozed no longer comes back at the old time.
```

Bad:

```
## v1.1.0 - Big update!
We're thrilled to unlock a seamless new reminders experience.

### What's New
- Refactored the reminders service and added a recurrence column (migration 0031)
- Various improvements and bug fixes
- Bumped drizzle-orm to 0.44.3
```

It names code, says nothing a person can use, uses a dash and an exclamation
mark, and sells instead of telling.

## 8. Older versions

The file starts at 0.3.25, the first version whose changes could be written up
from the history with confidence. Earlier versions are not in it. A version
that had no visible change can be left out of the file, but one that was
released and changed something is never added later without its real date.
