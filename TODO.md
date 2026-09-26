# Todo

Things that are deliberately not done yet, and what unblocks each. Anything with
a **you** tag needs Nathan rather than a session.

---

## 1. Replace the placeholder legal texts with real ones — **you**

Phase 1 ships with **invented** contract templates so the machinery can be built
and tested. They are structurally plausible and legally worthless.

Every seeded template carries `reviewedAt: null`, and the app treats that as a
first-class state:

- The template list marks them plainly as not reviewed.
- Generating from one stamps a visible specimen banner into the document.
- The signing screen refuses to treat an unreviewed template as final.

**What to do:** rewrite each template's body with your real text, then clear the
specimen flag on it. The placeholder syntax and the available fields are
documented in `docs/templates.md`.

**Do not send a document generated from an unreviewed template to a client.**
That is what the banner is for, and why it is on the page rather than in a
tooltip.

## 2. Decide what the in-app assistant runs on - **you**

Phase 6 is built except its assistant panel. Everything the panel would drive
is there: 163 tools, the approval gate, briefings and automations. What it needs
and nothing else does is a model, which means three answers from you.

- **Which provider**, and whether Juno ever talks to one at all. PLAN.md is
  binding that the app opens, syncs and works with no key configured, so the
  panel is additive and absent by default.
- **Where the key lives.** `safeStorage`, like a mail password, by decision 6.
  Nothing about a key belongs in `.env` or the build.
- **What it may do unattended.** Nothing changes about the gate: an assistant
  is a caller like any other and its side-effectful calls park for approval.

Until then an external agent does the same work. Open Agent, copy the
configuration, paste it into Claude Desktop or Claude Code. That also answers
phase 6's done-when in PLAN.md.

## 3. Smaller things

nothing serves them over stdio yet. That is phase 6 in `PLAN.md`; the
descriptors are written per feature so that phase is assembly, not archaeology.

- **Projects overview layout.** Remove the max-width constraint and use fixed responsive padding that grows slightly on larger screens. In the rows view, let the title and description column fill the remaining space after the other columns keep fixed widths, and truncate overflowing text with an ellipsis.
- **Client detail quick status.** Add a small clickable status tag beside the client name in the detail header. Changing it should update the client and add a timeline entry, coalescing changes made within 10 minutes into one entry and removing the entry when the status is changed back to its original value.
  no `StatementSync.setReturnArrays`. If the host Node moves past 24 this can go
  back to plain `vitest`.
- **Database encryption** is out of scope and would mean revisiting decision 18,
  since `node:sqlite` cannot do SQLCipher. The likely answer then is
  `@libsql/client`.
- **Purging a removed mail account.** Removing an account forgets its password
  and soft-deletes the row; its messages and attachments stay on disk until a
  purge exists. That purge is a confirmed action, never an MCP tool.
- **The reader frame has a fixed height** with a taller and shorter toggle,
  because a sandboxed frame cannot report its content height. A resize handle
  would be nicer.
- **Unsent drafts are not merged into the Drafts folder.** Juno's own drafts
  live in the outbox and the server's live in its Drafts folder, and the
  Drafts view says so in a line pointing at the outbox rather than showing
  both. Merging them means reconciling two row types through one list, its
  selection and its menu.
- **Nothing files mail on a schedule, and nothing should.** Filing is
  side-effectful, so it is excluded from anything unattended by the same rule
  that keeps sending out of an automation.
- **The composer is plain text.** A small fixed toolbar (bold, a link, a list)
  is the phase 4 promise not yet kept. Templates carry their own layout, so it
  matters least for the messages Juno writes on its own.
- **A new mail template starts from an empty canvas.** The plus on the list
  asks for a name and opens the editor on a canvas with one empty section, and
  the name doubles as the subject until somebody changes it. What is still
  missing is a starting point for the body: an opening line and a signoff, the
  way the seeded templates share `SIGNOFF_U` and `SIGNOFF_JE` in
  `mail-templates-seed.ts`, laid in as blocks rather than typed from nothing.
  The editor no longer offers the register, so a starter either picks u, which
  is what the contracts use, or comes as two starters to choose from.
- **Sent messages show in the reader only after the Sent folder is synced.**
  Until then the outbox is the record. Showing outbox rows inside a thread
  would close the gap.
- **No other calendar has read a Juno .ics file yet.** Export a month, open
  it in Google Calendar or Outlook, and check the moved occurrence of a
  recurring event after the October change. Then import an Outlook export the
  other way; its Windows zone names are handled through the file's VTIMEZONE,
  which is tested against a hand-written one and not yet a real one.
- **No third-party MCP client has connected yet.** The smoke run starts the
  real bridge and speaks MCP to it, so the socket, the token and the wire are
  covered, but Claude Desktop and Claude Code have not. Try both, and check
  that a tool list cached while Juno was closed recovers when it opens.
- **The audit log has no purge.** It grows by one row per write. A year of
  ordinary use is a few thousand rows, so this is not urgent, but "keep the
  last N months" belongs next to the backup settings eventually.
- **An automation cannot pass one step's result to the next.** Steps are
  independent calls with fixed arguments. Anything that needs the output of a
  previous step is a job for an agent, which can read and then decide, rather
  than for a recording.

## 4. The main sidebar collapses on its own

Small, one session. Start with `/screen-new` only if a new component is
needed; this is mostly a change to an existing hook.

**What it does.** The main sidebar (`src/app/Sidebar.tsx`) starts as the rail.
Opened fully, it goes back to the rail by itself when an entry in it is chosen
or when anything outside it is clicked, the way the narrow-window drawer
already closes. A setting turns the going-back off, and then the sidebar stays
the way it was left, as it does today.

**Files.**

- `electron/shared/types.ts`: `AppSettings` gains `sidebarAutoCollapse: boolean`.
- `electron/main/services/settings.ts`: default `true` in `DEFAULTS`, read with
  a boolean fallback in the parse near line 280, and a getter and setter
  beside `getTheme` and `setTheme`.
- The IPC adapter, the preload bridge and `electron/shared/api.ts`: one channel
  each way, named like the theme's.
- `electron/main/mcp/settings.ts`: `settings.get_sidebar_auto_collapse` and
  `settings.set_sidebar_auto_collapse`, the setter marked side-effectful but
  local, like `settings.set_theme` (mcp.md section 4).
- `src/features/settings/AppearanceSection.tsx`: a checkbox under the theme,
  "Collapse the sidebar on its own", with one line under it: "The sidebar goes
  back to icons when you choose something or click beside it."
- `src/app/use-sidebar-layout.ts`: the stored preference defaults to collapsed
  when nothing is stored, and a new `autoCollapse` input makes `close()`
  collapse a docked, expanded sidebar as well as the drawer.
- `src/app/App.tsx` (around line 124): `sidebar.close()` after a choice is
  called for a docked sidebar too, not only when `floating`. A pointerdown
  outside the sidebar collapses it, the same listener the drawer uses.
- The settings window is a separate modal window, so the main window has to
  hear the change: re-read the setting on `window.childClosed`, which is how a
  setting reaches the main window today.
- `.claude/rules/styling.md` section 5b: the table and the paragraph under it
  describe the new default and the setting.

**Done when.**

- A test for the settings service: the default is on, and the value survives a
  write and a read.
- The smoke walk (`electron/main.ts`) opens the sidebar fully, clicks a screen,
  and checks it is a rail again; then turns the setting off in the settings
  window and checks it stays open.
- Looked at in both themes, wide and medium windows. The narrow-window drawer
  behaves exactly as before.

## 5. Mail template editor

Three pieces of work, in this order, because the second changes the model the
third and the example build on. Read docs/editors.md section 2 and decisions
36 and 37 first; every rule there still holds. Each piece is its own set of
commits, and each keeps the four checks green: `npm run check`,
`JUNO_SMOKE_DEMO=1 JUNO_SMOKE_FRONT=1 npm run smoke`, both themes looked at, and
the copy sweep in writing.md section 7.

### 5a. A tool for every element a mail client renders, grouped like Figma's

**What it does.** The floating toolbar
(`src/features/templates/mail/canvas/CanvasToolbar.tsx`) becomes groups. Each
group is one button with a chevron beside it, and the chevron opens a menu of
the group's elements, each with its name and its key, the way Figma's frame
tool opens Frame, Section and Slice. The button adds the group's last-used
element (remembered per machine in localStorage, like autosave). What is added
is that HTML element, so the layers and the code view name it for what it is,
and the tag can be changed afterwards in the design panel within its group,
the way a heading's level is changed now.

| Group | Elements | Notes |
| --- | --- | --- |
| **Containers** | section, div, header, footer, main, article, aside, nav | Each lays out what is in it the way a section does now: flow, gap, padding, alignment, breakpoints. Each can hold blocks and other containers |
| **Text** | h1 to h6, p, blockquote, pre, address, span, and a list (ul or ol with li) | The element only. Bold, italic, underline and links stay inside the text, on the format bar |
| **Columns** | a table laid out for mail: `table role="presentation"`, rows, cells | The one layout that stays side by side in Outlook on Windows ("The Outlook problem" in docs/editors.md). Cells hold blocks |
| **Media** | img, and img inside a link | Video, audio and embeds play in no client that matters. The menu says so in one line instead of offering them: a video is a picture with an on-click action to where it plays |
| **Other** | hr, and a declared input | As they are now |

**The model change, which is the bulk of it.**

- Today `MailLayout.sections` is one level: sections hold blocks, and a
  section compiles to a `div`. Containers nest, so the model becomes a tree: a
  container holds an ordered list of children, each a container, a text
  element, a table or a leaf block. Keep ids stable; breakpoints key their
  overrides by id and must keep working (`breakpoints.ts`,
  `parseBreakpoints` and `breakpointRules` in `mail-layout.ts`).
- Give every element a `tag` field, checked against its group's list in the
  parser the way `toColor` checks a colour. A text element's `kind` stays
  "text" or "heading"; the tag says which one it is written as.
- **A schema version bump, not a migration.** The layout is JSON in
  `layout_json`, so there is no Drizzle migration, but `MailLayout.version`
  goes to 2 and `normaliseLayout` reads a version 1 layout into the tree:
  each section becomes a `section` container holding its blocks. Every
  template saved today must open unchanged, and a test must prove it.
- The compiler writes each element with its own tag, keeps the `data-juno-*`
  markers, and `layoutFromHtml` reads them back, nested. The code view round
  trip tests in `mail-layout.test.ts` must pass for nested containers and for
  a table.
- The layers panel (`LayerTree.tsx`) becomes a real tree: expand and collapse
  at every level, drag into and out of containers, Alt and an arrow still move
  one place. The canvas drop targets follow.
- `sizing.ts` works per parent rather than per section, since any container is
  a parent now.

**Files you will touch.** `electron/shared/types.ts`,
`electron/main/services/mail-layout.ts` and its test, `canvas-actions.ts`,
`breakpoints.ts`, `sizing.ts`, `CanvasView.tsx`, `LayerTree.tsx`,
`DesignPanel.tsx`, `CanvasToolbar.tsx`, `shortcuts.ts` (keys per element, and
the list the toolbar shows), `MailTemplateEditor.tsx` (insert, paste,
duplicate), the MCP layout description in `electron/main/mcp/mail-outbox.ts`,
and docs/editors.md.

**Decide before starting.** Whether the old sections become `section`
elements in the sent HTML or stay `div`s. `section` is the better HTML;
some older clients style unknown block elements oddly, so the compiler may
want `display:block` on every one. Test in the preview and write the choice
down in docs/editors.md.

**Done when.** A version 1 layout loads and sends byte for byte the same body.
Every element in the table can be added from the toolbar and from its key,
changed within its group, nested, dragged in the layers, hidden at a
breakpoint, converted to HTML, and read back from the code view. The smoke walk
adds one element of each group and nests a text block in a header.

### 5b. Actions instead of a button block

**What it does.** The button leaves the toolbar. Every element gets an
**Actions** section in the design panel, after Effects, listing actions as rows
like the effects: a trigger, what it does, an eye and a minus.

| Trigger | What it can do | Compiles to | Where it works |
| --- | --- | --- | --- |
| **On click** | Open a link (https), start a mail (mailto), call (tel) | The element wrapped in an `<a>`, or an `<a>` itself for inline text | Every client |
| **On hover** | Change the fill, text colour, underline or opacity | A `:hover` rule in the head, next to the breakpoints, `!important` like them | Apple Mail, iOS, Outlook on the web. Not Gmail, not Outlook on Windows; the panel says so on the row |

Nothing else: focus, scroll and timed triggers need a script.

- A button becomes a text element with a fill, a radius and an on-click
  action. Existing `button` blocks keep loading and compiling, the way
  dividers and spacers do now; they are simply not offered.
- `safeHref` already refuses anything but https and mailto; add tel there,
  with a test, and refuse everything else as it does now.
- The hover rules come out of the same place as the breakpoints
  (`breakpointRules` in `mail-layout.ts`), so the class names and the
  sanitising are shared, and a rule can never contain an angle bracket.
- A link on a whole block must not wrap block elements in a way clients
  break: an `<a>` around a `div` is valid HTML5 and Gmail keeps it, but test it
  in the preview and in the Outlook note.

**No custom JavaScript.** Not a choice Juno gets to make: every mail client
removes `<script>` and every `on*` handler before the reader sees the message,
Gmail and Outlook drop the whole element, and mail with scripts in it scores
as spam. `sanitiseMarkup` strips them for that reason. The two triggers above
are the whole of what an email can do when somebody interacts with it. Do not
add a script field, and do not let a code block carry one.

**Done when.** Tests: an on-click action compiles to a link and reads back from
the code view; a hover action writes one rule with the element's class; tel,
mailto and https pass and javascript, data and http do not. The smoke walk adds
an on-click action to a text block and checks the sent HTML has the link.

### 5c. Replace the shipped templates with one example of everything

**What it does.** The four shipped mail templates (`contract_cover`,
`project_kickoff`, `invoice_due`, `hosting_renewal` in
`electron/main/services/mail-templates-seed.ts`) are hidden, and one example
ships in their place: a single canvas template that uses every part of the
editor, so opening it teaches the canvas. Written in Dutch, "u", by writing.md
section 1, and native, not translated.

What it has to show, one of each:

- A header container with a logo picture (an https address) and a linked
  Google font on the heading.
- Rich text with bold, italic, a link and a placeholder (`{{client.firstName}}`).
- A picture input the template asks for, in the Asks view.
- Two columns across that stack into one at a Phone breakpoint, and a Columns
  table for comparison.
- A divider: an empty section with a height and a bottom stroke.
- A gradient fill, a drop shadow, rounded corners, a colour with opacity.
- A text element with an on-click action, styled as a button, with a hover
  action.
- A code block.
- A footer container with the business details, which the house frame used to
  add and a canvas no longer does (decision 37).

**Careful: `contract_cover` is used.** `src/features/documents/DocumentDetail.tsx`
(around line 376) sends a signed document with `templateKey: "contract_cover"`,
and the smoke walk looks it up by key (`electron/main.ts` around line 288).
Hiding it breaks sending a contract. Either keep `contract_cover` and hide the
other three, or make the example the cover template and point both callers at
it. Decide with Nathan, and do not leave a caller pointing at a hidden row.

**How, by the seeding rules (data.md section 9, decision 16).**

- Shipped rows are never deleted: rows already point at them. Bump
  `MAIL_TEMPLATE_SEED_VERSION` and teach `ensureMailTemplatesSeeded` to set
  `hidden_at` on a retired seed key, but only on a row whose `customisedAt`
  and `hiddenAt` are null. An edited one is the owner's and stays as it is.
- The example gets its own `seed_key`, `isSystem: true`, and a layout, so it
  seeds with a canvas rather than hand-written HTML. `reviewedAt` stays null
  like every shipped text, so the list marks it unreviewed.
- The reset in settings (reference data) must restore the example and must not
  bring back the retired ones.

**Done when.** A test seeds version 1, edits one retired template, seeds the new
version, and checks: the edited one is untouched and visible, the rest are
hidden, the example exists with a canvas, and seeding again changes nothing.
The smoke walk opens the example, and its preview renders with no missing
values against the demo client. Send the example to yourself once and read it
in Gmail on a phone and in Outlook on Windows, and write down what each shows.
