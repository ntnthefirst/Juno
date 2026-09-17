<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo/bureau-wordmark-paper.svg">
  <img src="brand/logo/bureau-wordmark-ink.svg" alt="Bureau" width="150">
</picture>

Where the paperwork of running a small business happens, on your own machine,
without a subscription.

Bureau keeps clients, contracts, mail, dates and reminders in one place,
generates the documents you would otherwise retype, and exposes everything it can
do to an AI agent so the boring parts can be asked for instead of clicked
through.

**Status: day zero.** Nothing is built yet. The plan, the rules and the design
system are written; phase 0 is next. See [PLAN.md](PLAN.md).

---

## Why it exists

Running a one-person business means retyping the same client details into the
same five contracts, losing a thread because it was in a different mailbox, and
remembering on the 12th that an invoice was due on the 1st. None of that is work.
It is friction around the work.

Existing tools solve it by putting everything in someone else's cloud, per seat,
per month, with your client data as the hostage. Bureau solves it locally
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
| **Reminders** | Paperwork that is due, invoices that need writing, payments that need making. Bureau tells you; it does not act on its own |
| **Automations** | A recorded sequence of the same operations the interface uses, behind a button |
| **MCP** | Every capability is a local MCP tool, so Claude or any other agent can run the same operations you can |

## What it deliberately does not do

- **No invoicing and no payments.** Bureau reminds you to invoice and tracks what
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
  logo/                 Mark, wordmark, application icon, favicon
.claude/
  rules/                How to write code here, one file per topic
  skills/               Step-by-step workflows for recurring tasks
```

Application code arrives in phase 0, under `electron/` and `src/`.

## Getting started

Nothing to run yet. When phase 0 lands this section describes `npm install` and
`npm run dev`; until then, start with [PLAN.md](PLAN.md) and
[docs/decisions.md](docs/decisions.md).

## Licence

None yet, which means all rights reserved. That is the deliberate default while
the question is open, because adding a permissive licence later is easy and
withdrawing one is not. The decision to make before this repository goes public
is whether a company should be able to take Bureau, host it, and sell it back.
