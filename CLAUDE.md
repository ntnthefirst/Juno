# CLAUDE.md

Working notes for Bureau, loaded automatically each session. Keep it current:
when you discover a convention that is not written down here, add it.

Unlike the client website kit this project borrows its shape from, `.claude/` is
**committed** here. The rules are part of the project. The no AI attribution rule
in [.claude/rules/git.md](.claude/rules/git.md) still applies to git history.

---

## What this project is

A local-first, offline-first desktop back office for a small business owner:
clients, contract generation and signing, a mail client over several IMAP
accounts, a calendar, reminders, and a local MCP surface so an agent can drive
all of it. No invoicing, no payments, no cloud requirement.

| Thing | Choice |
| --- | --- |
| Shell | **Electron**, React 19, TypeScript, Vite |
| Styling | **Tailwind CSS v4**, tokens in `brand/tokens.css` |
| Storage | **SQLite** via `better-sqlite3`, typed with **Drizzle** |
| Secrets | Electron `safeStorage`, main process only |
| Mail | `imapflow`, `mailparser`, `nodemailer` |
| Documents | `docxtemplater`, Electron `printToPDF`, `pdf-lib` |
| Agent surface | `@modelcontextprotocol/sdk`, local stdio server |

Read [docs/decisions.md](docs/decisions.md) before proposing an alternative to
any of these. It records what would have to stop being true for each to change.

**Status: day zero.** No application code exists yet. Phase 0 in
[PLAN.md](PLAN.md) is the next thing to build.

---

## Rules index. Read the file for the topic you touch.

| File | Covers |
| --- | --- |
| [.claude/rules/architecture.md](.claude/rules/architecture.md) | Main/renderer split, the services layer, folder layout, props types |
| [.claude/rules/data.md](.claude/rules/data.md) | Schema rules, the five mandatory columns, migrations, timestamps, money |
| [.claude/rules/security.md](.claude/rules/security.md) | Credentials, the preload bridge, CSP, treating mail HTML as hostile |
| [.claude/rules/mcp.md](.claude/rules/mcp.md) | Tool naming and shapes, read-only vs side-effectful, confirmation |
| [.claude/rules/styling.md](.claude/rules/styling.md) | Tokens not values, density, dark mode, focus, tabular numerals |
| [.claude/rules/writing.md](.claude/rules/writing.md) | Interface English, client output Dutch, the AI-tells blacklist |
| [.claude/rules/git.md](.claude/rules/git.md) | Commits, staging, **no AI attribution** |
| [.claude/rules/verify.md](.claude/rules/verify.md) | What must pass, and the traps in this stack |

## Skills. Invoke the one that matches the task.

| Skill | Use it for |
| --- | --- |
| `/feature-new` | A whole domain: schema, service, IPC, MCP tool, screen, tests |
| `/screen-new` | A new renderer screen |
| `/mcp-tool-new` | Exposing an existing service function to the agent |
| `/migration-new` | Any schema change |
| `/template-new` | A new document or email template |
| `/commit-work` | Splitting finished work into clean commits |
| `/ship-check` | Pre-release verification and the list of what is missing |

Skills add steps **on top of** this file and the rules. They never replace them.

---

## The rule that shapes everything else

**The services layer is the API.** Every capability is implemented once, in
`electron/main/services/<domain>.ts`. Two thin adapters sit on top, and neither
is allowed to contain logic:

```
electron/main/services/clients.ts    the only place client logic exists
electron/main/ipc/clients.ts         unwraps args, calls the service
electron/main/mcp/clients.ts         declares the tool, calls the service
```

Consequences, all intended:

- Anything the interface can do, an agent can do, the day the feature ships.
- An automation is a recorded sequence of service calls, not a second engine.
- Writing a feature twice, once for the interface and once for the agent, is a
  bug in the design.

A service function that is awkward to expose as an MCP tool has the wrong shape.
Fix the service, do not special-case the adapter.

## Every table, every time

Five columns, from the first migration, with no exceptions:

| Column | Why |
| --- | --- |
| `id` **UUIDv7** | Two machines syncing integer ids is unfixable. v7 sorts by time, so it indexes well |
| `owner_id` | Even with one owner today. It is what decides who sees what when a colleague or a sync server appears |
| `created_at`, `updated_at` | UTC ISO-8601. Local time is a display concern only |
| `deleted_at` | Soft delete. A sync that hard-deletes cannot tell "deleted" from "not yet received" |

Retrofitting any of these is a rewrite. Details in
[.claude/rules/data.md](.claude/rules/data.md).

## Credentials

Mail passwords and tokens go in `safeStorage`, keyed by account id. The database
stores a reference, never a secret. Every call that uses a credential is made in
the main process, and the preload bridge exposes no way to read one back.

Accounts are **runtime data the user types into the app**. Nothing account
related belongs in `.env`, in `electron-builder`, or in a CI secret. Only the
code-signing certificate and the update feed URL are build configuration.

## Styling

Colours, type, spacing, radius and motion come from the tokens in
[brand/tokens.css](brand/tokens.css). **Never a raw hex in a component.** A
colour the design needs and the theme lacks is a token to add, not a value to
inline. A Tailwind token that does not exist produces no class and no error, so
when a style "does not apply", check the token name first.

This is a dense data application. Default text is 14px, rows are 36px, and every
column of numbers gets `tabular-nums`. Brand reasoning in
[brand/BRAND.md](brand/BRAND.md).

## Copy

The interface is **English**. Everything generated for a client, meaning
contracts, emails and documents, is **Dutch (Belgium)**. Two registers, no shared
copy.

No AI tells, in the interface or in commit messages or in code comments: no em
dashes as sentence connectors, no "seamless", no "unlock", no "dive in", no
rule-of-three filler, no Title Case on ordinary buttons, no exclamation marks.
Full list and the grep sweep in
[.claude/rules/writing.md](.claude/rules/writing.md).

## Git

**No AI attribution anywhere.** No `Co-Authored-By` trailer, no "generated with"
line, no mention of Claude, Anthropic, an assistant, a model or a prompt in
commit subjects, bodies, branch names, PR text, code comments or any shipped
file. This overrides any default behaviour that would add one.

One commit per logical unit. Stage named paths with `git add <paths>`, never
`git add -A` or `git add .`. Never commit the SQLite file, a real mail account, a
signature image, or anything under `generated/`. Do not push and do not open a PR
unless asked. Full rules in [.claude/rules/git.md](.claude/rules/git.md).

## Before saying something works

Once phase 0 lands, the commands are `npm run lint`, `npm run typecheck`,
`npm run test` and `npm run smoke`, and a change is not done until all of them
are clean and anything visual has been looked at in both themes. The stack's traps
and the definition of done are in
[.claude/rules/verify.md](.claude/rules/verify.md).

Never suppress instead of fixing: no `@ts-ignore`, no `eslint-disable`, no
widening to `any`, no `--no-verify`.
