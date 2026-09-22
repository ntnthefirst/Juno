# Architecture rules

How Juno is organised, and the shape every file follows. The point of this
layout is that a capability is written once and both the UI and an agent get it.

---

## 1. Four layers, one job each

| Layer | Lives in | Job | Never does |
| --- | --- | --- | --- |
| **Renderer** | `src/` | React UI: screens, components, local view state | Talk to SQLite, `fs`, IMAP, `safeStorage`, or any node module |
| **Preload** | `electron/preload/index.ts` | Expose a narrow, typed `contextBridge` API of named channels | Contain logic, expose `ipcRenderer` itself, or expose a generic `invoke(channel, args)` |
| **Adapters** | `electron/main/ipc/`, `electron/main/mcp/` | Unwrap arguments, call one service function, return its result | Validate business rules, touch the DB, format for one caller |
| **Services** | `electron/main/services/` | Every capability in the app, implemented exactly once | Know whether the caller is a window or an agent |

Below the services sit `electron/main/db/` (schema, migrations, the connection)
and `electron/main/vault/` (`safeStorage` read/write). Services are the only
thing allowed to call them.

This is decision 2 in [../../docs/decisions.md](../../docs/decisions.md), and it
is the rule the rest of the project is built on.

## 2. Folder layout

```
electron/
  main/
    index.ts              app lifecycle, window creation, protocol registration
    db/
      schema.ts           Drizzle table definitions
      migrations/         generated SQL, committed, run forward on launch
      client.ts           opens the file, runs pending migrations, exports `db`
    services/
      clients.ts          the only place client logic exists
      documents.ts
      mail.ts
      calendar.ts
      reminders.ts
    ipc/
      clients.ts          thin: unwraps args, calls the service
      index.ts            registers every handler once, at startup
    mcp/
      clients.ts          thin: declares the tools, calls the service
      index.ts            starts the server, registers every tool
    vault/
      index.ts            safeStorage get/set/delete, keyed by account id
    windows/
      index.ts            the registry: one main window, one modal settings child
      chrome.ts           CSP, navigation rules, the native title-bar overlay
      main-window.ts      the application window
      settings-window.ts  fixed size, modal child of the main window
      splash.ts           the window shown while the database opens
    updates.ts            electron-updater against the public GitHub releases
    dev-data.ts           where a development run keeps its data
  preload/
    index.ts              contextBridge only
src/
  features/
    clients/              screens and feature components for one domain
    mail/
    documents/
  components/             shared UI primitives: button.tsx, data-table.tsx
  lib/                    renderer-only helpers: formatting, query keys, hooks
  styles/tokens.css       copied from brand/tokens.css
```

Import with the `@/` alias from the project root. No `../../..` chains, and
nothing in `src/` ever imports from `electron/` except a shared type, imported
with `import type`.

## 3. Services are the API

A service function is a plain async function with typed arguments and a typed
return. It is the unit both adapters call.

- **It returns the full typed row, never a partial.** `createClient()` returns
  the `Client` row it wrote, not the id, not `void`. A caller that wants one
  field takes one field.
- **It validates its own input**, because the MCP adapter has no idea what a
  valid VAT number is. Validation in the adapter means the other adapter skips it.
- **It throws typed errors**, not strings. Both adapters need to turn a failure
  into a message a person reads, and a message an agent reads.
- **No `BrowserWindow`, no `event`, no `sender` in a service signature.** If a
  service needs to notify the UI, it emits on an app-level event bus that the IPC
  layer subscribes to. A service that takes a window cannot be called by MCP.
- One domain per file. When `mail.ts` passes roughly 400 lines, split by sub-domain
  (`mail/sync.ts`, `mail/compose.ts`) and keep the same rule inside.

If a service function is awkward to expose as an MCP tool, the service has the
wrong shape. Fix the service, not the adapter. See [mcp.md](mcp.md).

## 4. Adapters carry no logic

An IPC handler and an MCP tool for the same capability should be boring enough to
read side by side and see they do the same thing.

```ts
// electron/main/ipc/clients.ts
ipcMain.handle("clients:create", (_event, input: CreateClientInput) =>
	clients.create(input),
);
```

Banned in an adapter: an `if` that decides a business outcome, a DB import, a
default value the other adapter does not also apply, a second service call
sequenced into a transaction. A two-step operation is one service function.

## 4b. Windows

There is **one** main window, and `main/windows/index.ts` is the only file
allowed to make one. A second launch focuses the window that exists.

**Settings is a window, not a screen.** It is a modal child of the main window,
which is what makes the operating system refuse input to the application behind
it until it is closed. It is a fixed size, it is reached from the sidebar
footer, and it is not a `ScreenId`. Its renderer entry is the same bundle: the
URL carries `#/settings` and `src/main.tsx` picks the shell from that, so the
right one paints on the first frame.

Both windows draw their own title bar and let the operating system draw the
caption buttons on top (`chrome.ts`). Three things have to move together when
the title bar height changes: `TITLEBAR_HEIGHT`, `--titlebar-height`, and the
gutters in `src/lib/platform.ts`. Change one and the close button sits off the
bar or over a control.

A renderer never asks which window it is over IPC. It reads its own URL.

## 5. Renderer rules

- **One component per file**, default export, file named `kebab-case.tsx`, the
  component inside `PascalCase` and matching the file name.
- **If a component takes props, it declares a named props type, and that type is
  the first declaration in the file** after the imports:

  ```tsx
  type ClientRowProps = {
  	client: Client;
  	selected?: boolean;
  	onSelect: (id: string) => void;
  };
  ```

  Never an inline signature type (`({ client }: { client: Client })`), never an
  untyped destructure, never `React.FC`. A component with no props declares no
  type. Prefer `type` over `interface`.
- A feature folder owns its screens and the components only it uses. Something
  used by two features moves to `src/components/`.
- Data access goes through one typed client wrapper over the preload bridge in
  `src/lib/`, not scattered `window.juno.*` calls in components.
- No state-management library. React state plus the query cache is the toolchain.

## 6. Where business logic may and may not live

May: `electron/main/services/`. That is the list.

May not: a React component, a hook, a preload function, an IPC handler, an MCP
tool, a Drizzle query written at a call site. A rule like "a client with an open
document cannot be archived" lives in `services/clients.ts` and nowhere else, or
it will be true in the UI and false for the agent.

The renderer may hold **view** logic: which tab is open, what is selected, how a
date is formatted for display. Formatting is not a business rule.

## 7. What NOT to do

- Don't enable `nodeIntegration` or disable `contextIsolation` to make an import
  work. See [security.md](security.md).
- Don't import `better-sqlite3`, `imapflow`, `fs` or `path` from anything under
  `src/`. It builds in dev and breaks in the packaged app.
- Don't add a second persistence layer. SQLite is the source of truth, always
  (decision 5).
- Don't add invoicing, numbering or payment code, however small the shortcut looks
  (decision 9).
- Don't let a file move ride along with a content change. A move is its own commit.
