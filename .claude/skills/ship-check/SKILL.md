---
name: ship-check
description: Pre-release check before a Bureau build is installed or handed over. Runs full verification, migrates from empty, boots the app with no network, proves no credential is reachable from the renderer, sweeps TODO markers and AI tells, checks dark mode, and reports what is still missing. Use when the user says "is it ready", "I want to install this", "cut a build", "we're shipping".
---

# Workflow: pre-release check

Two outputs: **a go/no-go on the build**, and **a plain list of what is still
missing**. Run it before every install on the owner's own machine, not only
before a public release. This app holds the business's real data; a bad build
costs more than a rebuild.

---

## Step 1 — The build must be clean

```bash
npm run typecheck
npm run lint
npm run test
npm run smoke
```

All four, in that order, no warnings waved through. Read the output rather than
the exit code: a test that was skipped is not a test that passed.

Then `npm run build`, since main-process, preload and native-module problems
only appear in a packaged app. Install the artifact and launch it once. A build
that only works under `npm run dev` is not shipped.

## Step 2 — Migrations apply from empty

```bash
rm -f .tmp/ship.db
npm run db:migrate -- --db .tmp/ship.db
```

Every migration in order, on an empty file, no errors. This is exactly what a
fresh install does, and it is the check most likely to have been skipped
([migration-new](../migration-new/SKILL.md)).

Then launch the packaged app pointed at a **fresh profile**, not the owner's. It
must create its database, migrate, and open on a first-run state with no rows;
every main screen shows an empty state instead of a crash or a blank pane.

Finally launch it against a **copy** of the owner's real database and confirm the
migrations run forward there too, row counts unchanged on tables this release did
not touch. The copy, never the original ([data.md](../../rules/data.md)).

## Step 3 — It boots offline

The whole promise of the app ([decisions.md](../../../docs/decisions.md), 5).

Disable the network on the machine, then launch:

- [ ] The app opens. No hang, no spinner that never resolves, no error dialog.
- [ ] Clients, documents, calendar, reminders and already-synced mail all read
      and render.
- [ ] Creating and editing works, fully.
- [ ] Nothing in the network panel of the dev tools. No font request, no
      telemetry, no update check blocking the UI. Fonts are bundled
      ([decisions.md](../../../docs/decisions.md), 10).
- [ ] A mail sync fails with a clear message naming the network as the reason,
      and leaves the local data intact.

```bash
grep -rniE "fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr" src electron index.html
```

Empty, other than the update-feed URL, which is the one remote thing allowed and
is never on the boot path.

## Step 4 — No credential is reachable from the renderer

The rule from [decisions.md](../../../docs/decisions.md), 6 and
[security.md](../../rules/security.md): credentials go in `safeStorage`, the
database stores a reference, and the renderer has no API that returns a secret.

```bash
grep -rniE "password|passwd|token|secret|api[-_]?key" src | grep -v "\.test\."
grep -rn "safeStorage" src
grep -rn "nodeIntegration\|contextIsolation\|sandbox" electron/main
grep -rn "contextBridge.exposeInMainWorld" electron/preload
grep -rniE "@gmail|@outlook|imap\.|smtp\." src electron db --include="*.ts"
```

- [ ] `src/` (the renderer) contains no credential handling and no `safeStorage`
      reference at all.
- [ ] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- [ ] The preload bridge is an explicit list of channels, not a passthrough that
      forwards any channel name it is given.
- [ ] No real mail host, address or account name anywhere in the source.
- [ ] Nothing account-related is in the build config: no `.env`, no
      `electron-builder` entry, no CI secret. Only the code-signing certificate
      and the update-feed URL are build configuration.

Then check by hand, in the running app's dev tools console: every bridge method
that touches an account returns a reference or a status, never a secret.

## Step 5 — Sweep the outstanding markers

```bash
grep -rn "TODO(asset)" src electron templates brand
grep -rn "TODO(copy)" src electron templates
grep -rn "TODO\|FIXME" src electron templates | grep -v "TODO(asset)\|TODO(copy)"
```

The last grep catches markers written in the wrong format. Fix those to the right
prefix so they appear in future sweeps.

**Every remaining `TODO(asset)` and `TODO(copy)` goes in the Step 8 report**, one
line each, in plain language, saying what is missing and why it matters. A
`TODO(copy)` sitting in a contract template is a release blocker, not a footnote:
a missing clause in a document someone signs is the worst kind of gap
([template-new](../template-new/SKILL.md)).

## Step 6 — Sweep for AI tells

Per [writing.md](../../rules/writing.md). This covers the UI copy, the templates
and the commit history.

```bash
LC_ALL=en_US.UTF-8 grep -rn "[—–]" src templates README.md
LC_ALL=en_US.UTF-8 grep -rn "[’‘“”…]" src templates README.md
grep -rniE "ontdek|naadloo|dé oplossing|hoger niveau|op maat van uw|beste van twee werelden|unlock|elevate|seamless|game.changer|supercharge|revolutioni|unleash|dive in" src templates README.md
grep -rniE "claude|anthropic|copilot|chatgpt|generated with|AI assistant" src electron db templates README.md docs
git log --format="%s%n%b" -40 | LC_ALL=en_US.UTF-8 grep -n "[—–]"
git log --format="%an <%ae>%n%s%n%b" -40 | grep -iE "claude|anthropic|co-authored|generated with|assistant"
git ls-files | grep -iE "\.db$|\.db-wal|\.db-shm|\.bak|signature|\.env"
```

**Keep the `LC_ALL=en_US.UTF-8` prefix.** Without it, Git Bash matches these
classes byte by byte and reports curly quotes as em dashes, which makes the whole
sweep untrustworthy.

Read every hit in context rather than blind-replacing: a dash in a range
(`ma-vr`, `9-17`) is correct, and a phrase inside a legal clause the owner wrote
stays as the owner wrote it. The last two greps must be **empty**, and so must
the `git ls-files` one. If something did get committed, say so plainly: not
pushed means it can be fixed, pushed means it is the owner's call.

## Step 7 — Look at the app

With the packaged build running, walk every screen:

- [ ] **Light and dark**, both, every screen. Switch with `data-theme` on
      `:root`. Check surfaces, borders, the status tints and the focus ring
      ([styling.md](../../rules/styling.md)).
- [ ] Narrow and wide window. No horizontal scroll, no clipped sidebar, no table
      that pushes its own container.
- [ ] Empty, loading and error states on every screen, forced by hand.
- [ ] Tab through each screen: visible focus everywhere, Escape closes dialogs.
- [ ] Render one document template and one email template to preview, including
      the case where every optional field is empty.
- [ ] Console has no errors.
- [ ] The MCP tool list is complete: every service verb has a tool, and
      everything that sends, signs, deletes or files refuses without confirmation
      ([mcp.md](../../rules/mcp.md)).
- [ ] Nothing in the UI claims the signature is a qualified electronic signature.
- [ ] Nothing in the UI issues, numbers or sends an invoice.

## Step 8 — Report

Three short blocks, nothing else:

1. **Status** — build clean or not, migrations from empty, offline boot,
   credential check. Each a yes or a no, with the failure first if there is one.
2. **Still missing** — the `TODO(asset)` and `TODO(copy)` sweep as plain lines,
   grouped by area, no file paths.
3. **Before this is installed** — the unticked items from Steps 3, 4 and 7, each
   with a one-line reason it matters.

Don't bury a failure in a paragraph. If the build is broken or a credential is
reachable, that is the first line.

## Commit

This skill mostly reads. When it fixes something small (a wrong TODO prefix, a
stray `console.log`, a curly quote), commit per [git.md](../../rules/git.md) and
[commit-work](../commit-work/SKILL.md): named paths, plain subject, **no AI
attribution, no `Co-Authored-By`, no "generated with"**.

Don't publish a release, don't tag, don't upload an artifact. That is the owner's
action.

## What this skill does

- Runs typecheck, lint, tests, build and package, and reports failures first.
- Proves migrations apply from empty and forward on a copy of the real database.
- Boots the app with no network and confirms every read still works.
- Confirms no credential, mail account or secret is reachable from the renderer.
- Sweeps TODO markers and AI tells in the code, the templates and the history,
  then reports what is still missing.

## What this skill does NOT do

- It doesn't publish, tag, sign or upload a release.
- It doesn't run anything against the owner's live database.
- It doesn't fix real problems it finds beyond trivial hygiene. Those get
  reported.
- It doesn't rewrite git history on its own. It reports and offers.
- It doesn't send mail, render a document to a client, or sign anything.
