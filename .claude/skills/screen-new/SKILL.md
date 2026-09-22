---
name: screen-new
description: Build a new renderer screen or panel in Juno - a client list, a document detail view, an inbox pane, a dashboard card. Use when the user asks for a view over data that a service already exposes ("show me the mailbox", "add a screen for reminders"). Not for adding a whole domain including its service and tools - use feature-new. Not for a change to a screen that already exists.
---

# Workflow: a new renderer screen

**Follow [CLAUDE.md](../../../CLAUDE.md) and [.claude/rules/](../../rules/)
throughout.** This file adds where the screen lives, how it gets its data, and
the states it must have before it counts as done.

A screen is a **view over a service**. It owns layout and interaction. It owns no
business logic, no SQL, no credential, and no knowledge of how mail is fetched.

---

## Step 0 — The data has to exist first

Before writing any JSX, check the service exposes what the screen needs:

```bash
ls electron/main/services
grep -rn "export function" electron/main/services/<domain>.ts
grep -rn "<domain>:" electron/main/ipc/<domain>.ts
```

If a function is missing, stop and add it in the service and both adapters
first ([feature-new](../feature-new/SKILL.md)). Never work around a missing
service call by querying, filtering or aggregating in the renderer. A number the
screen computes is a number the agent cannot get.

## Step 1 — Place the folder

```
src/features/<domain>/
  <domain>-screen.tsx        the route-level screen
  <domain>-list.tsx          pieces of this screen only
  <domain>-detail.tsx
  use-<domain>.ts            the hook that calls the bridge
src/components/              shared across two or more features
src/components/layout/       sidebar, titlebar, command palette
```

The second feature that needs a piece is what moves it to `src/components/`.
Don't pre-abstract the first one, don't copy-paste the second one. A shared
component takes everything through props and hardcodes no domain copy.

One component per file, `kebab-case.tsx`, default export, `PascalCase` name
matching the file. Props type named `<Name>Props`, declared first after the
imports, never an inline signature type.

## Step 2 — Data access, only through the bridge

```ts
const clients = await window.juno.clients.list({ includeArchived: false });
```

- **Only the preload bridge.** No `better-sqlite3` import, no Drizzle import, no
  `ipcRenderer` used directly, no service import
  ([architecture.md](../../rules/architecture.md)).
- **No credential ever reaches this layer.** There is no bridge call that returns
  a password or a token, and adding one is the bug
  ([security.md](../../rules/security.md)).
- The call is async; the screen is not allowed to assume it resolved.
- Reads are local and fast. A read must never wait on the network. If the screen
  shows something that needs a sync, it renders the local data first and the sync
  is a separate, visible, cancellable action
  ([decisions.md](../../../docs/decisions.md), 5).

## Step 3 — The four states, all of them

A screen with only the happy path is not finished. Write all four before styling
any of them:

- [ ] **Loading.** A skeleton at the real row height (`--row-height`), not a
      spinner in the middle of an empty page, and not a layout that jumps when
      the data lands.
- [ ] **Empty.** One line saying what goes here in plain Dutch, plus the action
      that creates the first record. Never "No data found."
- [ ] **Error.** The message from the service, shown in `--risk` text on
      `--risk-soft`, plus a retry control. Never a blank screen, never a
      `console.error` as the only signal.
- [ ] **Loaded.** Including the ugly cases: 500 rows, a client name that wraps to
      three lines, a null email, a document with no signature yet.

## Step 4 — Density and tokens

Juno is a dense application, not a marketing page. From
`src/styles/tokens.css` ([styling.md](../../rules/styling.md)):

- **Text**: `--text-base` (14px) is default UI text. Table cells and list rows
  use `--text-dense` (13px). Labels `--text-sm`, badges `--text-micro`. At most
  one `--text-h1` per screen.
- **Rows**: `--row-height` (36px). Don't invent a row height per screen.
- **Spacing**: the `--space-*` scale, 4px base. Panel padding `--space-4`, section
  gaps `--space-6`. No arbitrary pixel values.
- **Colour**: `--paper` is the window, `--surface` is panels and cards sitting on
  it, `--sunken` is wells and table headers. Text `--ink`, secondary
  `--ink-muted`. `--ink-faint` is decorative and large text only, never body
  copy. **No raw hex anywhere in a component.**
- **Borders do the work.** Shadow is for things that float: `--shadow-popover`,
  `--shadow-modal`. A card gets a `--line` border, not a shadow.
- **`--seal` is the one warm note**, for signed and sealed and done. One use per
  screen at most.
- **Numbers line up**: any column of amounts, dates, counts or ids gets the
  `.tabular` class.
- Motion is `--duration-fast` or `--duration-base` with `--ease`. Nothing longer,
  nothing bouncing.

A colour or size the screen needs and the tokens lack is a token to add to
`tokens.css`, agreed in one line first, never an arbitrary value at the call
site.

## Step 5 — Keyboard and focus

This is a desktop app the owner lives in all day. Mouse-only is a defect.

- [ ] Every action reachable by Tab, in visual order. No positive `tabIndex`.
- [ ] Interactive things are `<button>` or `<a>`, never a `<div>` with `onClick`.
      Icon-only buttons carry an `aria-label`.
- [ ] Visible focus ring using `--focus` on every focusable element. **Never
      remove the ring; restyle it.**
- [ ] Lists: up and down arrows move the selection, Enter opens, Escape closes a
      panel or dialog and returns focus to whatever opened it.
- [ ] A destructive control is not the first thing Tab reaches, and it confirms.
- [ ] Dialogs trap focus and close on Escape.

## Step 6 — Look at it

Run the app ([verify.md](../../rules/verify.md)) and check, for real:

- [ ] Light and **dark**, both. Switch with `data-theme` on `:root`. Every
      surface, border and status tint has a dark value; a screen that only works
      in light is half written.
- [ ] Narrow window and wide window. The sidebar is `--sidebar-width`; the
      content pane has to survive both.
- [ ] All four states from Step 3, forced by hand if necessary.
- [ ] No console errors.
- [ ] Offline: disable the network, reload. Reads still work.

## Step 7 — Commit

Per [git.md](../../rules/git.md). One screen plus its route registration in one
commit. A screen nothing routes to cannot be reviewed.

```bash
git add src/features/reminders src/app/routes.tsx
git commit -m "Add reminders screen"
```

Plain human subject. No AI attribution, no `Co-Authored-By`, no "generated with".

## What this skill does

- Files the screen under `src/features/<domain>/` and keeps shared pieces out
  until a second caller exists.
- Forces data access through the IPC bridge only.
- Requires loading, empty, error and loaded states before any styling.
- Applies the token density rules instead of arbitrary sizes and colours.
- Checks keyboard access, focus rings, dark mode and offline reads.

## What this skill does NOT do

- It doesn't add service functions, IPC channels or MCP tools. That's
  `/feature-new` and `/mcp-tool-new`.
- It doesn't query the database from the renderer or compute business numbers
  there.
- It doesn't add a UI dependency (chart library, table library, animation
  package) without asking first.
- It doesn't ship a screen that only exists in light mode.
- It doesn't push or open a PR.
