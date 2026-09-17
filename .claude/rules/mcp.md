# MCP rules

How the agent surface is built: one tool per service capability, named the same
way every time, and never firing something irreversible on its own.

---

## 1. MCP is an adapter, not a feature

Decision 2 in [../../docs/decisions.md](../../docs/decisions.md) restated as
something you can check in a diff:

- A tool file in `electron/main/mcp/<domain>.ts` declares tools and calls
  `services/<domain>.ts`. That is all it does.
- **If a diff adds logic to an MCP file, it is in the wrong file.** No `if` that
  decides a business outcome, no DB import, no second service call sequenced into
  a transaction, no default value the IPC adapter does not also apply.
- A capability that exists in the UI and not as a tool is an unfinished feature,
  not a backlog item. They ship in the same commit.
- If a service function is awkward to expose (it takes a `BrowserWindow`, returns
  a React-shaped object, needs three calls to do one thing), fix the service.
  Special-casing the adapter hides the problem in the place nobody reads.

## 2. Naming: `domain.verb`

Lowercase, dot-separated, singular domain, one verb.

```
clients.list          clients.get          clients.create
clients.update        clients.archive
mail.sync             mail.search          mail.get_thread
mail.send
documents.render      documents.sign       documents.list_templates
calendar.list_events  calendar.create_event
reminders.list        reminders.complete
```

- The domain matches the service file name. `clients.*` is `services/clients.ts`.
- Verbs are reused across domains, so an agent can guess: `list`, `get`, `search`,
  `create`, `update`, `archive`, `delete`. Don't invent `fetch`, `retrieve`,
  `getAll`, `remove`.
- Multi-word verbs are `snake_case`: `mail.get_thread`, not `mail.getThread`.
- A tool is never named after a screen. `clients.list`, not `clients.table_view`.

## 3. Arguments and returns

- **Arguments are a flat object with a declared schema and a description per
  field.** No positional arguments, no free-form string an agent has to format.
  The description is what stops a wrong call, so write it for a reader who has
  never seen the schema: "VAT number in BE0123456789 format".
- Ids are ids. A tool takes `client_id`, never "the client named Jansen". Name
  resolution is `clients.search`, a separate call.
- **Returns are the service's typed row, serialised, with no reshaping.** Dates
  stay UTC ISO-8601 strings, money stays integer cents ([data.md](data.md)).
  Formatting for a human is the caller's job, not the tool's.
- List tools take `limit` and `cursor` and default to a bounded page. A tool that
  can return 40,000 mail rows will, once, into a context window.
- Errors come back as a typed failure with a message that says what to do next
  ([writing.md](writing.md)), not a stack trace and not a bare `false`.
- Every tool is scoped by `owner_id` and filters soft-deleted rows, exactly like
  the UI does. The agent is not an admin.

## 4. Read-only versus side-effectful, and the confirmation rule

Every tool declares which it is, in its description and in a `sideEffect` flag on
the registration. There is no third category.

**Read-only** (safe to call unattended, any number of times): `clients.list`,
`clients.get`, `mail.search`, `mail.get_thread`, `calendar.list_events`,
`reminders.list`, `documents.list_templates`.

**Side-effectful**: everything that writes, and in particular everything that
**sends, signs, deletes or files something**: `mail.send`, `documents.sign`,
`documents.file`, `clients.delete`, `calendar.create_event` when it invites
someone.

The rule, and it does not bend:

> A tool that sends, signs, deletes or files something requires explicit
> confirmation from the user in the app before it executes, and must never fire
> unattended. Not on a timer, not as a step inside an automation, not because the
> agent is confident.

In practice:

- The tool call does not perform the action. It creates a **pending action** the
  user sees, with the full rendered payload (the actual email body, the actual
  PDF, the actual rows to be deleted) and an approve or reject choice. The tool
  returns "pending, id X". Approval happens in the UI, by a person.
- The confirmation is enforced in the **service**, not the tool. A service that
  can be made to send without an approval record is the bug; the adapter cannot be
  the only gate, because IPC would then skip it.
- A rejected or expired pending action is never retried automatically.
- No "confirm once, apply to all". No remembered consent. Per action, every time.
- Bulk operations are one pending action listing every affected row, not N
  approvals and not one blanket yes.

Writes that only touch local records (`clients.update`, `reminders.complete`)
execute directly, but are still marked side-effectful so they are excluded from
anything that runs on a schedule without a person watching.

## 5. Automations are recorded sequences of tool calls

An automation is not a second engine (decision 2). It is a stored list of service
calls with their arguments, replayed in order.

- Stored in its own table with the five standard columns, each step referencing a
  tool name and an argument object.
- Replay goes through the same service functions, so the same validation and the
  same confirmation gate apply. An automation cannot send mail unattended for the
  same reason an agent cannot.
- A step that hits a pending action stops the run and waits. It does not skip and
  it does not continue past it.
- Every run writes a log row: which steps ran, what they returned, where it
  stopped. An automation nobody can audit is an automation nobody should trust.

## 6. Adding a tool without touching the service

The normal case, and it should take one small file change.

1. The service function already exists and is used by the UI.
2. Add the tool declaration in `electron/main/mcp/<domain>.ts`: name, description,
   argument schema, `sideEffect` flag.
3. The handler is one line that calls the service and returns its result.
4. Register it in `electron/main/mcp/index.ts`.
5. Write the description as instructions to a stranger, then check it: a tool
   named well with a bad description gets called at the wrong time.

If step 3 cannot be one line, stop and fix the service first.

## 7. What NOT to do

- Don't expose a `sql.query` tool, a `fs.read` tool, or anything that takes a raw
  path or statement. See [security.md](security.md).
- Don't expose a tool that returns a credential, in any form, masked or not.
- Don't add a tool that drives the UI ("open the clients screen"). The agent
  operates the business, not the window.
- Don't let a tool be the only caller of a service function. If the UI cannot do
  it, question whether it should exist.
- Don't version tools by suffix (`clients.list_v2`). Change the schema and the
  description together, in one commit.
