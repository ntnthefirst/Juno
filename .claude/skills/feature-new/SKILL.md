---
name: feature-new
description: Add a whole domain to Bureau end to end - clients, documents, mail, calendar, reminders, templates. Walks the mandated order: Drizzle schema and migration, service module, IPC adapter, MCP tool(s), renderer screen, tests. Use when the user asks for a new feature area ("add reminders", "I want contracts in here"), not for changing one that exists and not for a single screen (use screen-new) or a single tool (use mcp-tool-new).
---

# Workflow: a new domain, end to end

**Follow [CLAUDE.md](../../../CLAUDE.md) and [.claude/rules/](../../rules/)
throughout.** This file adds the build order, which is not negotiable, and the
checks at each layer.

The order exists because every layer below depends on the one above it being
final. Writing the screen first means writing the service twice.

```
1. schema + migration    db/schema/<domain>.ts, db/migrations/
2. service               electron/main/services/<domain>.ts    <- all the logic
3. IPC adapter           electron/main/ipc/<domain>.ts         <- thin
4. MCP tool(s)           electron/main/mcp/<domain>.ts         <- thin
5. renderer screen       src/features/<domain>/
6. tests                 service tests first, then the adapters
```

---

## Step 0 — Scope the domain before touching a file

Write down, in the chat, in three lines:

- The **nouns**: one table each, singular concept, plural table name.
- The **verbs**: every operation the owner will do. These become service
  functions and, one for one, MCP tools.
- What it is **not**. Bureau does no invoicing and no payments
  ([decisions.md](../../../docs/decisions.md), 9). A reminder that says "invoice
  this" is in scope. Generating an invoice is not.

If a verb cannot be phrased as `domain.verb(args) -> result`, the domain is
still two domains. Split it.

## Step 1 — Schema and migration

Table per noun in `db/schema/<domain>.ts`. **Every table carries the five
mandatory columns, from its first migration** ([data.md](../../rules/data.md)):

- [ ] `id` text primary key, **UUIDv7**, never autoincrement.
- [ ] `owner_id` text not null, even though there is one owner today.
- [ ] `created_at` text not null, UTC ISO-8601.
- [ ] `updated_at` text not null, UTC ISO-8601.
- [ ] `deleted_at` text nullable, UTC ISO-8601. Soft delete, always.

Retrofitting any of these is a rewrite. Then generate the migration and run it
forward. Never hand-edit a migration that has been applied
([migration-new](../migration-new/SKILL.md) is the full procedure, including the
backup step if the owner's real database is involved).

Foreign keys point at `id`. Every query in the service filters
`isNull(deleted_at)` unless it explicitly wants the deleted rows.

## Step 2 — The service module

`electron/main/services/<domain>.ts` is **the API**. This is the most important
rule in the project ([architecture.md](../../rules/architecture.md),
[decisions.md](../../../docs/decisions.md), 2).

```ts
export type CreateClientInput = {
	name: string;
	email?: string;
	vatNumber?: string;
};

export function createClient(input: CreateClientInput): Client { /* ... */ }
export function listClients(filter?: ClientFilter): Client[] { /* ... */ }
export function getClient(id: string): Client | null { /* ... */ }
export function updateClient(id: string, patch: UpdateClientInput): Client { /* ... */ }
export function archiveClient(id: string): void { /* ... */ }
```

Non-negotiables:

- **Plain functions taking plain serialisable arguments** and returning plain
  serialisable results. No Electron types, no IPC event objects, no React types,
  no class instances crossing the boundary. If it cannot survive
  `structuredClone`, it is the wrong shape.
- **Named input and output types**, exported, declared above the functions.
- **Validate at the top of the function**, not in the adapter. Both adapters call
  the same function, so the validation has to live where both reach it.
- **Every credential-using call happens here, in main.** The renderer never sees
  a password or a token ([security.md](../../rules/security.md)).
- Timestamps written in UTC. Local time is display only.
- Errors: throw a typed error with a code the adapters can pass through, never a
  bare string, never a silent `null` that means three different things.

If a function is awkward to expose as an MCP tool, **the service has the wrong
shape**. Fix the service. Do not special-case the adapter.

## Step 3 — The IPC adapter

`electron/main/ipc/<domain>.ts`. One handler per service function, registered by
channel name `<domain>:<verb>`. The handler unwraps arguments, calls the
service, returns the result. **That is the whole file.**

```ts
ipcMain.handle("clients:create", (_e, input: CreateClientInput) => createClient(input));
```

A conditional, a loop, a default value or a second service call inside a handler
is logic in the wrong layer. Move it into the service.

Expose the channel through the preload bridge with `contextIsolation` on and
`nodeIntegration` off. The bridge surface is an explicit list, never a passthrough
that forwards any channel name.

## Step 4 — The MCP tool(s)

`electron/main/mcp/<domain>.ts`. **Skipping this is not allowed. A feature the
agent cannot drive is unfinished**, and it ships in the same commit as the
service, not in a follow-up ([mcp.md](../../rules/mcp.md)).

Every verb from Step 0 gets a tool, named `domain.verb`, classified read-only or
side-effectful, with a described argument schema. Anything that sends, signs,
deletes or files requires confirmation. Full procedure and the naming rules:
[mcp-tool-new](../mcp-tool-new/SKILL.md).

## Step 5 — The renderer screen

`src/features/<domain>/`, reaching data only through the IPC bridge, never
through the database and never through a service import. Loading, empty and error
states, keyboard access, dark mode, tokens from `src/styles/tokens.css`. Full
procedure: [screen-new](../screen-new/SKILL.md).

## Step 6 — Tests

- **Service tests carry the weight.** Against a temporary SQLite file, migrations
  applied from empty. Cover each verb, the soft-delete filter, and the rejection
  case for every validation you wrote.
- **Adapter tests are thin**, matching the adapters: the channel is registered,
  the tool is listed, arguments arrive intact. If an adapter test needs a
  scenario, that scenario belongs to a service test.
- One offline test: the domain's read paths work with no network.

## Step 7 — Verify, then commit

Per [verify.md](../../rules/verify.md): typecheck, lint, tests, migrations apply
from an empty database, and the app boots. Then look at the screen.

Commit per [git.md](../../rules/git.md) and
[commit-work](../commit-work/SKILL.md), in the build order, each commit leaving
the app working:

```
Add reminders table and migration
Add reminders service
Expose reminders over IPC and MCP
Add reminders screen
Add reminders service tests
```

Plain human subjects. No AI attribution, ever.

## What this skill does

- Fixes the order: schema, service, IPC, MCP, screen, tests.
- Puts every line of logic in the service and keeps both adapters thin.
- Enforces the five mandatory columns and soft deletes from the first migration.
- Treats the MCP tool as part of the feature, not an extra.
- Splits the work into commits that each leave the app working.

## What this skill does NOT do

- It doesn't add invoicing, invoice numbering or anything that moves money.
- It doesn't let the renderer touch the database or a credential.
- It doesn't add a dependency that [decisions.md](../../../docs/decisions.md)
  doesn't already name, without asking first.
- It doesn't ship a service function with no MCP tool.
- It doesn't push or open a PR.
