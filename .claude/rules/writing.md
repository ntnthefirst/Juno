# Writing rules

Applies to everything a person reads: UI labels, buttons, empty states, error
messages, generated contracts and emails, commit messages and code comments. In
short, anything that ships plus anything that lands in git history.

---

## 1. Two languages, and they don't mix

| Surface | Language |
| --- | --- |
| App UI: menus, buttons, labels, tooltips, errors, settings | **English** |
| Generated client documents: contracts, quotes, letters | **Dutch (nl-BE)** |
| Generated client emails and HTML email templates | **Dutch (nl-BE)** |
| Code, identifiers, comments, commits, docs | **English** |

- The UI is English because the developer reads it and the vocabulary is
  technical. The output is Dutch because a Belgian client reads it.
- Belgian Dutch, not Netherlands Dutch: "factuur" not "rekening", "gsm" not
  "mobiel", "btw-nummer" not "omzetbelastingnummer". Write it natively. A native
  speaker must not be able to tell it was translated.
- Pick "u" or "je" per template and hold it for the whole document. Never mixed in
  one letter. Contracts are "u"; a follow-up email to a client you know can be
  "je" if the template says so.
- A template's placeholder names stay English (`{{client_name}}`,
  `{{project_title}}`). Only the surrounding prose is Dutch.
- Never machine-translate a Dutch template from an English one. Write the Dutch.

## 2. No AI tells

These patterns make text read as machine-written. Banned in both languages.

- **No em dashes or en dashes as sentence connectors.** Use a period, a comma, or
  restructure. A hyphen in a compound word is fine.
- **No stock phrases.**
  - English: "dive in", "unlock", "elevate", "seamless", "seamlessly",
    "game-changer", "in today's fast-paced world", "it's important to note",
    "let's explore", "unleash", "supercharge", "revolutionize", "at the end of the
    day", "when it comes to", "take it to the next level", "streamline your
    workflow", "effortlessly", "powerful yet simple", "all-in-one solution".
  - Dutch: "ontdek", "naadloos", "dé oplossing voor", "in de snel veranderende
    wereld van", "het beste van twee werelden", "wij nemen u mee", "til uw
    <iets> naar een hoger niveau", "op maat van uw noden", "niet alleen ..., maar
    ook ...".
- **No rule-of-three filler** ("fast, flexible and reliable") unless all three are
  true and each adds information.
- **No Title Case on ordinary buttons or labels.** "Add client", "Send for
  signature", "Sync now". Not "Add Client", not "Sync Now". Proper nouns and the
  first word only.
- **No exclamation marks in the UI.** Not in a success toast, not in an empty
  state, not in an error. "Document signed." is the whole message.
- **No emoji** in the UI, in a document, in a commit, or in a comment.
- **No repeated openers** down a settings page ("Additionally... Furthermore...").
- **No curly quotes or ellipsis characters** where the file uses straight quotes
  and three periods. Match the file.
- **No bullet list standing in for prose** in a document template. A contract
  clause is a sentence.
- **No mention of AI, Claude or Anthropic**, anywhere, ever. See [git.md](git.md).

## 3. Plain, short, second person

- Address the user as "you". "You have no clients yet", not "The user has no
  clients" and not "No clients found for this account".
- Short, direct sentences. One idea each. Active voice.
- Say what the thing is, not how good it is. "Pulls mail from your IMAP accounts
  into this machine" beats "a powerful unified inbox experience".
- Cut marketing adjectives: "cutting-edge", "world-class", "intuitive",
  "powerful", "hoogstaand", "uniek", "toonaangevend".
- Concrete over abstract: a count, a date, an account name, a file path.
- Before writing new copy, read a neighbouring screen and match its register.
  Consistency beats your preference.

## 4. Length per surface

| Surface | Target |
| --- | --- |
| Button / menu item | 1 to 3 words, verb first ("Add client", "Sign", "Sync now") |
| Column header | 1 to 2 words, no punctuation |
| Field label | 1 to 3 words, sentence case, no trailing colon |
| Helper text under a field | One sentence, under 15 words |
| Empty state | A heading of 2 to 5 words plus one sentence saying what to do |
| Toast | One sentence, under 10 words, past tense ("Client archived.") |
| Confirmation dialog | One sentence stating what will happen and what it affects |
| Tooltip | Under 8 words, no full stop |

## 5. Error messages: what happened, then what to do

Two clauses. No apology, no blame, no stack trace shown to the user.

```
Bad:  Error: ECONNREFUSED
Bad:  Oops! Something went wrong. Please try again later!
Good: Could not reach imap.example.com. Check the server address in account settings.
Good: The password for hallo@example.be was rejected. Update it in account settings.
Good: This client has 2 open documents. Close or delete them before archiving.
```

Rules:

- Name the thing that failed, by its real name (the account, the file, the server).
- Say the next action, and make it something the user can actually do here.
- Never "unknown error". If the cause is genuinely unknown, say what failed and
  where the detail is: "Sync failed. The full error is in the log at Help > Open
  log folder."
- Never show a raw exception message or a path inside `node_modules`.
- A destructive confirmation states the consequence and the count: "Delete 14
  messages from this machine? They stay on the server."
- Error text is English like the rest of the UI, even when the failing document is
  Dutch.

## 6. Code comments and commit messages

- Comments explain **why**, not what the line obviously does. A comment restating
  the code is noise.
- Comments in English, sentence case, no decorative banners (`// ===== MAIL =====`),
  no commented-out code left behind, no `console.log` in committed code.
- A comment marking a real trap is worth writing: "better-sqlite3 is sync, so this
  runs on the main thread; keep it indexed."
- **No comment mentions AI, an assistant, a prompt or a generation step.** No
  "generated by", no "as requested".
- Commit messages: plain, imperative, human. See [git.md](git.md). Same voice
  rules, including no em dashes.
- `TODO(...)` markers are fine and get a parenthesised owner or reason:
  `TODO(mail): handle CONDSTORE so a resync is incremental`.

## 7. How this gets checked

A rule nobody checks is a rule that decays. Run this sweep before a hand-off and
after writing a batch of copy.

```bash
LC_ALL=en_US.UTF-8 grep -rn "[—–]" src electron docs README.md
LC_ALL=en_US.UTF-8 grep -rn "[’‘“”…]" src electron docs README.md
grep -rniE "seamless|unlock|dive in|elevate|game.changer|supercharge|revolutioni|unleash|fast-paced|effortless|all-in-one|streamline your|ontdek|naadloo|dé oplossing|hoger niveau|op maat van uw|beste van twee werelden" src electron docs README.md
grep -rn "!" src --include=*.tsx | grep -iE ">[^<]*!<"
grep -rniE "claude|anthropic|\bAI\b|copilot|generated with" src electron docs README.md .github
git log --format="%s%n%b" -30 | LC_ALL=en_US.UTF-8 grep -nE "[—–]|[Cc]laude|Anthropic|Co-Authored"
```

**The `LC_ALL=en_US.UTF-8` prefix is not optional.** Without it, Git Bash on
Windows matches these bracket classes byte by byte, and every one of these
characters starts with the same two UTF-8 bytes, so a search for em dashes also
reports curly quotes and ellipses. With the prefix the matches are exact.

Reading the results:

- **Dashes:** a hit inside a range (`ma-vr`, `9-17`) is fine. A hit between two
  clauses is the thing to fix.
- **Exclamation marks:** the third sweep finds them in JSX text. A `!` in code
  (`!isOpen`, `!==`) is not a hit worth reading.
- **Curly quotes:** fine if a file uses them consistently. Mixed in one file is the
  bug. Dutch templates may legitimately use them; then the whole template does.
- **AI mentions:** every hit gets fixed, no exceptions. The `.claude/` folder is
  committed here (decision 12), so it is excluded from that sweep by path, but
  nothing under `src/`, `electron/` or `docs/` may mention it.
