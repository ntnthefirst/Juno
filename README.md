<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo/juno-wordmark-paper.svg">
  <img src="brand/logo/juno-wordmark-ink.svg" alt="Juno" width="150">
</picture>

Where the paperwork of running a small business happens, on your own machine,
without a subscription.

Juno keeps clients, contracts, mail, dates and reminders in one place,
generates the documents you would otherwise retype, and exposes everything it can
do to an AI agent so the boring parts can be asked for instead of clicked
through.

**Status: phases 0 to 6 built.** The app builds, packages, installs and runs.
Clients, documents, reminders, a mail client with an outbox, a calendar with
recurrence and .ics exchange, and an MCP server that exposes all of it to an
agent behind an approval gate. Mail has not yet met a real server, and the
in-app assistant panel waits on a model decision. What is built and what is not
is tracked in [BUILD-LOG.md](BUILD-LOG.md); what comes next is in
[PLAN.md](PLAN.md).

---

## Why it exists

Running a one-person business means retyping the same client details into the
same five contracts, losing a thread because it was in a different mailbox, and
remembering on the 12th that an invoice was due on the 1st. None of that is work.
It is friction around the work.

Existing tools solve it by putting everything in someone else's cloud, per seat,
per month, with your client data as the hostage. Juno solves it locally
instead. The database is a file on your disk. The app opens and works with the
network off. There is no server to pay for, which is what makes free actually
sustainable rather than a trial period.

## What it does

| | |
| --- | --- |
| **Clients** | One record per client, with contacts, projects and every document and mail thread attached to it |
| **Documents** | Fill your own `.docx` contract templates from a client record, output PDF, stamp a signature image with a timestamp and an audit trail |
| **Mail** | Pull several IMAP accounts into local storage, read and search them offline, link any thread to the client it belongs to, send from designed HTML templates |
| **Calendar** | Deadlines and appointments tied to projects, with `.ics` import and export |
| **Reminders** | Paperwork that is due, invoices that need writing, payments that need making. Juno tells you; it does not act on its own |
| **Automations** | A recorded sequence of the same operations the interface uses, behind a button |
| **MCP** | Every capability is a local MCP tool, so Claude or any other agent can run the same operations you can |

## What it deliberately does not do

- **No invoicing and no payments.** Juno reminds you to invoice and tracks what
  is owed. It never generates, numbers or sends an invoice, and it never moves
  money. Those carry legal requirements that differ by country and change; a
  reminder pointing at your real accounting tool carries none of them.
- **No qualified electronic signatures.** A stamped signature image with a
  timestamp and an audit trail is fine for low-stakes and internal documents. It
  is not an eIDAS qualified signature, the app does not claim to be, and
  high-stakes contracts should keep going through a provider.
- **No cloud requirement.** Sync between machines is a later, optional, additive
  layer. It will never become the thing the app needs in order to open.
- **Not a product.** It is built for one person first and generalised only where
  a second real user hits a wall.

## Built with

Electron, React, TypeScript and Vite, with SQLite through Drizzle for storage and
Tailwind v4 for styling. Credentials live in the OS keychain by way of Electron
`safeStorage` and never reach the renderer or the database.

The one architectural rule worth knowing before reading any code: **the services
layer is the API.** Every capability is implemented once as a service function,
and both the IPC bridge and the MCP server are thin adapters over it that hold no
logic of their own. Anything the interface can do, an agent can do, on the day
the feature ships. The reasoning is in [docs/decisions.md](docs/decisions.md).

## Repository layout

```
PLAN.md                 The phases, the data model, the MCP surface, the risks
docs/decisions.md       Locked technical decisions and the reason for each
brand/
  BRAND.md              Name, values, voice, colour and logo rules
  tokens.css            The design tokens. The source of truth for every value
  preview.html          The kit rendered in both themes. Open it in a browser
  logo/                 Mark, wordmark, application icon, favicon
.claude/
  rules/                How to write code here, one file per topic
  skills/               Step-by-step workflows for recurring tasks
electron/
  main.ts               Entry point. The boot order is commented and matters
  main/db/              Schema, migrations, the node:sqlite shim
  main/services/        All business logic. The API, per docs/decisions.md
  main/ipc/             Thin adapters over services, behind the lock guard
  main/mcp/             Thin adapters over the same services, for agents
  shared/               The contract both processes typecheck against
src/
  app/                  Shell, sidebar, title bar
  features/             One folder per screen
  components/           Dialog, Button, Field, Select, Toast
```

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` compiles the main process, starts Vite on 5173 and launches
Electron against it. A development run keeps its data in a directory of its own
(`Juno (dev)` beside the installed app's), so it cannot damage real records.
`npm run dev:clean` deletes that directory first, for testing a first run or a
migration from empty.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite, a main-process watch and Electron, on separate dev data |
| `npm run dev:clean` | The same, starting from an empty database |
| `npm run check` | lint, typecheck and test together |
| `npm run lint` | ESLint across renderer, main and scripts |
| `npm run typecheck` | Three project references: renderer, main, build scripts |
| `npm run test` | Vitest, under Electron's Node (see below) |
| `npm run smoke` | Compiles, launches the real app, fails on any renderer error |
| `npm run compile` | Main process plus renderer, no installer |
| `npm run build` | Everything, plus an installer for this platform, into `release/` |
| `npm run build:win` / `build:mac` | The same for one platform. What CI runs |
| `npm run icons` | Redraws the app icon and installer artwork from `brand/logo/` |
| `npm run db:generate` | Turns a schema change into a migration file |

`JUNO_SMOKE_DEMO=1 npm run smoke` seeds a demo business, walks every screen and
every settings tab, and writes a screenshot of each in both themes to `.smoke/`.

## Releases and updates

Tagging a version builds installers for Windows and macOS in GitHub Actions and
uploads them to a **draft** release. Publishing that release is what starts the
rollout: installed copies check once on launch and daily after, download in the
background, and install on the next quit.

```bash
npm version patch
git push --follow-tags
```

Two things that will otherwise waste an afternoon:

- **Tests run under Electron's Node, not the host's.** `node:sqlite` before Node
  24 has no `StatementSync.setReturnArrays`, which the storage shim depends on,
  so every query throws on an older host Node. The `test` script handles this.
- **`npm run smoke` is the only check that proves the app runs.** A clean
  typecheck says nothing about the custom scheme, the preload bridge or the
  database. Add `JUNO_SMOKE_DEMO=1` to have it create real records through the
  bridge and photograph both themes into `.smoke/`.

## Licence

None yet, which means all rights reserved. That is the deliberate default while
the question is open, because adding a permissive licence later is easy and
withdrawing one is not. The decision to make before this repository goes public
is whether a company should be able to take Juno, host it, and sell it back.
