---
name: mcp-tool-new
description: Expose an existing service function to the agent as an MCP tool - naming, argument and return shape, read-only versus side-effectful classification, and the confirmation requirement for anything that sends, signs, deletes or files. Use when a service function has no tool yet ("the agent can't see my reminders", "add an MCP tool for sending"), or when auditing the tool surface. Not for writing the service function itself - use feature-new.
---

# Workflow: a new MCP tool

**Follow [CLAUDE.md](../../../CLAUDE.md) and [.claude/rules/](../../rules/)
throughout, [mcp.md](../../rules/mcp.md) in particular.** This file is how to
add one tool to `electron/main/mcp/<domain>.ts` without putting logic in it.

The premise from [decisions.md](../../../docs/decisions.md), 2: the service is
the API, and the MCP layer is the second thin adapter over it. Anything the UI
can do, the agent can do, on the day the feature ships.

---

## Step 1 — Find the service function, and do not write one

```bash
grep -rn "export function" electron/main/services/<domain>.ts
grep -rn "server.tool\|registerTool" electron/main/mcp/
```

The tool wraps a function that already exists. If nothing fits:

- Missing capability, stop and build it in the service first
  ([feature-new](../feature-new/SKILL.md)).
- Fits badly (needs two calls, needs a loop, needs a default the UI supplies),
  **the service has the wrong shape**. Fix the service, and the IPC adapter gets
  the fix for free. Do not paper over it in the tool.

The tool file may contain: a name, a description, an argument schema, a
classification, and one call to the service. Nothing else. A branch or a second
service call in a tool is logic in the wrong layer.

## Step 2 — Name it `domain.verb`

Lowercase, dot separated, the domain matching the service file name.

| Good | Bad | Why |
| --- | --- | --- |
| `clients.list` | `getAllClients` | Domain first, camelCase is not the convention |
| `clients.create` | `clients.new` | Verbs, not adjectives |
| `documents.render_preview` | `documents.preview` | Say what it does; snake_case inside a segment |
| `mail.list_messages` | `mail.get` | Get what? |
| `mail.send_message` | `mail.send` | Explicit about the object |

Use the same verb across domains for the same shape of operation: `list`, `get`,
`create`, `update`, `archive`, `search`. An agent that learns `clients.list`
should be able to guess `reminders.list`.

One tool per service function. No `action` parameter that switches between four
operations, and no tool that lists and creates depending on its arguments.

## Step 3 — Arguments and return

- **Flat object of named arguments.** No positional arrays, no nested option bags
  three levels deep.
- **Every argument described in words, in the schema**, including the format of
  an id and the unit of a number. The description is the entire documentation the
  agent gets.
- **Ids are UUIDv7 strings** ([data.md](../../rules/data.md)). A tool never takes
  a row index or an offset into a list it returned earlier.
- **Timestamps are UTC ISO-8601 strings**, in and out. Never a locale string,
  never epoch milliseconds.
- **Optional arguments have real defaults in the service**, not in the tool.
- **Return the same plain object the service returns**, serialisable, with the
  ids in it so the next call can address the row. A tool that returns prose the
  agent has to parse is a broken tool.
- **List tools take a limit and return a total.** Unbounded lists bury the
  context window.
- **Never return a credential, a password, a token or a raw account
  configuration**, and never accept one as an argument
  ([security.md](../../rules/security.md)). Accounts are addressed by id; the
  secret stays in `safeStorage`, in main.

## Step 4 — Classify it: read-only or side-effectful

Every tool declares which it is. There is no third category and no default.

**Read-only** changes nothing an owner would notice. `clients.list`,
`documents.get`, `mail.search_messages`, `calendar.list_events`. Safe to call
speculatively, safe to retry, safe to call in a loop.

**Side-effectful** writes, sends or produces a file. `clients.create`,
`reminders.complete`, `documents.render`, `mail.send_message`.

Careful with the ones that look read-only:

- A mail sync writes rows. Side-effectful.
- Marking a message read changes remote state. Side-effectful.
- Rendering a document to disk creates a file. Side-effectful.
- A "preview" that only returns bytes without writing them is read-only. If it
  writes anywhere, it is not.

## Step 5 — Confirmation, for anything irreversible outside the app

**A tool that sends, signs, deletes or files requires explicit confirmation
before it acts.** These are the actions the owner cannot take back from inside
Bureau:

- **Sends**: any mail leaving the machine, any reply, any attachment going out.
- **Signs**: stamping the signature PNG onto a document, and the audit page that
  goes with it.
- **Deletes**: a hard delete, or a remote delete on an IMAP server. Soft deletes
  inside the local database are ordinary side-effectful writes.
- **Files**: writing a finished document into the client's folder, or marking
  something submitted or filed.

The pattern, so a confirmation cannot be skipped by calling a different tool:

1. A **preview** tool, read-only, returns exactly what would happen: the
   recipient, the subject, the rendered body, the file path, the row count.
2. The acting tool takes a `confirm: true` argument **and** the id or hash the
   preview returned, and refuses without both.
3. The refusal message names the preview tool to call first.

The confirmation is enforced in the **service**, not in the tool wrapper, so the
UI path gets the same guard. A tool that could be routed around by calling the
service directly is not guarded.

## Step 6 — Register and describe

Register the tool in `electron/main/mcp/<domain>.ts` and make sure the domain is
wired into the server's tool list. Then write the description the agent reads:
one sentence saying what it does, one saying when to use it, and, for a
side-effectful tool, one saying what it changes.

Say what is out of scope where it matters. Bureau does not invoice and does not
move money ([decisions.md](../../../docs/decisions.md), 9), so a reminders tool
description says it reminds and tracks, not that it bills.

## Step 7 — Verify

```bash
npm run typecheck
npm run test
```

Then, with the app running, from the agent side:

- [ ] The tool appears in the list with its description and full argument schema.
- [ ] A read-only call returns the same data the screen shows.
- [ ] A side-effectful call without `confirm` refuses, and says what to call
      first.
- [ ] The preview output matches what the confirmed call actually did.
- [ ] Nothing in any response contains a secret.
- [ ] It works offline, or fails with a clear message that says the network is
      the reason.

## Step 8 — Commit

Per [git.md](../../rules/git.md). The tool ships with the service function it
wraps, in the same commit as the IPC adapter when both are new.

```bash
git add electron/main/mcp/reminders.ts electron/main/mcp/index.ts
git commit -m "Expose reminders over MCP"
```

Plain human subject. No AI attribution, no `Co-Authored-By`, no "generated with".

## What this skill does

- Wraps an existing service function in one thin tool, with no logic added.
- Names tools `domain.verb` with consistent verbs across domains.
- Forces described, flat, serialisable arguments and id-carrying returns.
- Classifies every tool read-only or side-effectful, with no default.
- Requires preview plus confirm for sending, signing, deleting and filing, guarded
  in the service.

## What this skill does NOT do

- It doesn't write business logic in the MCP layer.
- It doesn't expose credentials, or accept them as arguments.
- It doesn't create a multiplexed tool that switches on an `action` argument.
- It doesn't invent a capability the service doesn't have.
- It doesn't push or open a PR.
