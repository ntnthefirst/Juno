# Styling rules

Tailwind CSS v4, configured CSS-first. Every value in the UI comes from
`brand/tokens.css`, copied into the app as `src/styles/tokens.css` and imported
once at the top of the global stylesheet.

---

## 1. The tokens are the design system

`brand/tokens.css` is the source of truth for colour, type, spacing, radius and
motion. The `@theme inline` block at the bottom of that file is what turns a token
into a utility class.

Real token names, so use these and not something that sounds right:

| Group | Tokens | Utilities |
| --- | --- | --- |
| Surfaces | `--paper`, `--surface`, `--sunken` | `bg-paper`, `bg-surface`, `bg-sunken` |
| Ink | `--ink`, `--ink-muted`, `--ink-faint` | `text-ink`, `text-ink-muted`, `text-ink-faint` |
| Lines | `--line`, `--line-strong` | `border-line`, `border-line-strong` |
| Accent | `--accent`, `--accent-hover`, `--accent-ink`, `--accent-soft` | `bg-accent`, `text-accent-ink`, `bg-accent-soft` |
| Seal | `--seal`, `--seal-soft` | `text-seal`, `bg-seal-soft` |
| Status | `--ok`/`--ok-soft`, `--warn`/`--warn-soft`, `--risk`/`--risk-soft` | `text-ok`, `bg-risk-soft` |
| Focus | `--focus` | `outline-focus` |

The palette is neutral: near-white greys in light, near-black in dark, with a
deep **iris** accent and a **brass** second note. Iris carries every interactive state. Brass is signed and sealed only, and
should appear about twice on a screen.

- `--paper` is the window background, `--surface` sits on it (cards, rows, panels),
  `--sunken` is for wells and table headers. Don't use `--surface` as a page
  background because it looks close enough in light mode; it is wrong in dark.
- `--ink-faint` is for decorative and large text only. **Never body copy, never a
  table cell.** It does not pass contrast at small sizes.
- `--seal` is the one warm note, used sparingly for signed and sealed states. It
  is not a second accent.
- Status colours come in a pair: the plain token for text and icons, `-soft` for
  the background tint behind them.

## 2. Never a raw value where a token exists

- **No hex, rgb or hsl in a component.** Not in `className`, not in `style`, not
  in an SVG `fill` that should follow the theme (use `currentColor` and set
  `text-accent`).
- **No `bg-[#28456c]`.** A colour the UI needs and the tokens lack is a token to
  add to `brand/tokens.css` and to the `@theme inline` block, not an arbitrary
  value at the call site. Say so in one line before adding it.
- Spacing uses the 4px scale (`--space-1` through `--space-16`). Radius uses
  `--radius-sm` for inputs and badges, `--radius-md` for buttons and rows,
  `--radius-lg` for cards, `--radius-xl` for modals. `--radius-full` is avatars
  and nothing else.
- Motion has its own section, 5e. In short: transform, opacity and colour only,
  never a layout property, and every curve and duration is a token.
- Shadows: `--shadow-popover` and `--shadow-modal` exist for things that float.
  Everything else is separated by a border. Borders do the work here.
- Opacity variants of a token are fine and preferred over a new token:
  `bg-ink/5`, `border-line/60`.

## 3. The Tailwind v4 trap: a missing token is silent

Adding a token to `:root` does **not** create a utility. The `@theme inline` block
has to map it (`--color-seal: var(--seal);`).

**A utility whose token does not exist produces no class and no error.**
`bg-accent-strong` when only `--accent-hover` exists renders unstyled, lint stays
green, the build passes. If a colour "isn't applying", check the token name in
`src/styles/tokens.css` before you change anything else.

So: add the token to `:root`, to both dark blocks, and to `@theme inline`, in the
same edit. All four or none.

## 4. This is a dense data application

Juno is a back office, not a marketing page. The type scale in the tokens is
already dense; don't reach past it.

- **Default UI text is `--text-base` (14px).** Table cells and list rows are
  `--text-dense` (13px). Secondary labels `--text-sm` (12px), badges and table
  meta `--text-micro` (11px).
- **Rows are `--row-height` (36px).** Not 48, not 56. A screen shows twenty clients
  without scrolling or it is the wrong screen.
- `--text-h1` (32px) appears at most once per screen, and most screens don't need
  it at all. A section heading is `--text-h3`.
- `--leading-tight` for headings and table rows, `--leading-normal` for UI text,
  `--leading-relaxed` only for long-form: document body and email text.
- The sidebar is `--sidebar-rail-width` (56px) and never wider, and the titlebar
  is `--titlebar-height`. Both are tokens because other things are measured
  against them, and because the title bar height is also the height of the
  native caption-button overlay ([architecture.md](architecture.md) section 4b).
- A row that carries an avatar is `--row-height-roomy` (44px). A row with no
  avatar is still `--row-height`.
- Padding inside a dense row is `--space-2` / `--space-3`. Marketing-page
  breathing room (`--space-12` and up) belongs to empty states and onboarding,
  nowhere else.

## 5. Theme is three states, and both of them get checked

The setting is `system`, `light` or `dark`, defaulting to `system` (decision 14).
A two-state toggle cannot say "follow the OS", which is what the setting is on
most machines most of the time.

Theme resolution is `:root` (light), then `@media (prefers-color-scheme: dark)`
guarded by `:root:not([data-theme="light"])`, then `:root[data-theme="dark"]` for
an explicit choice that wins. That cascade in `brand/tokens.css` already handles
all three states. Do not add a second mechanism next to it.

**Applying the setting is two writes, and one without the other is a bug you will
see immediately:** the renderer sets `data-theme` on `<html>`, and the main process
sets `nativeTheme.themeSource` to the same value so the title bar, the menus and
the native dialogs follow. Set only the first and a light title bar sits over a
dark window. Set only the second and the window chrome changes while the app does
not. `system` means removing the attribute and setting `themeSource` to `system`,
not resolving the OS preference yourself.

- Every screen gets looked at in **both** themes before it is done, and that
  includes screens reached only from a settings page or a lock screen. Toggle the
  `data-theme` attribute on `<html>`, don't just trust the tokens.
- The dark palette is not an inversion. `--accent` goes from a dark blue to a
  light one, and `--accent-ink` flips with it. A hardcoded white label on an
  accent button is invisible in dark mode; use `text-accent-ink`.
- Shadows are redefined in dark (heavier, blacker). Don't write your own.
- Images, logo variants and any generated PDF preview need checking too. There is
  a paper wordmark and an ink wordmark in `brand/logo/` for exactly this.

## 5b. The sidebar is a rail, and it never opens

`src/app/Sidebar.tsx` is a column of icons at `--sidebar-rail-width`. There is
no expanded state, no toggle, no drawer and no setting for any of them: the
name of an entry is in its tooltip (`components/Tooltip.tsx`, drawn by the
application, not the native `title`) and in its `aria-label`.

- **Six places on top, two entries at the bottom.** Overview, Calendar, Clients,
  Projects, Mail, Documents; then Agent and Settings. `app/screens.ts` lists
  them. A seventh entry is a decision, not an edit.
- **An entry has three colours and nothing else.** Soft (`--ink-faint`) at rest,
  firm (`--ink`) under the pointer, iris (`--accent`) when it is the page. No
  fill, no outline, no indicator bar. The one ring is the global
  `:focus-visible` one, which only a keyboard triggers, and it stays.
- **Icons are 20px with a 2.0 stroke.** Heroicons draw at 1.5, which is a hairline
  at this size next to the soft colour.
- **A badge is a dot,** and the count goes in the tooltip and the accessible name.
- **Screens without an entry** light the entry they belong to
  (`SIDEBAR_ENTRY`): Reminders under Overview, Styled mail under Mail,
  Templates under Documents.

### The switch

Mail and Documents each hold a second screen. It is not a second sidebar entry:
it is `components/SectionSwitch.tsx`, a two-sided control at the top of the page
(Mailbox | Styled mail, Documents | Templates), reached through the shell with
`requestOpen({ kind: "screen", screen })` so the target opens on its list. Add
a pair by adding a `ScreenSwitch` in `app/screens.ts`. Screens a form or an
editor has taken over show no switch, because they replace the page it sits on.

### Avatars and the time split

`components/Avatar.tsx` is initials on one of eight tints (`--tone-1` to
`--tone-8`, each with its `-ink`). The tint comes from the name, so a name is the
same colour everywhere. People are round, businesses and projects are squares.
Brass is never an avatar tint.

A list that is ordered by time is split with `lib/day-groups.ts`: Today,
Yesterday, Last 7 days, Last 30 days, then a month each. A list ordered by
relevance (a search) is not split, because the days would come out of order.

## 5c. Three shapes, and picking the wrong one is the bug

Decision 30. A surface is one of three things, and the choice is not a matter
of taste.

| Shape | Component | For |
| --- | --- | --- |
| Modal | `components/Dialog.tsx` | A question with two answers. Delete, discard, which occurrence |
| Page | `components/FormPage.tsx` | Anything with fields in it. Replaces the content, offers a way back |
| Side panel | `components/SidePanel.tsx` | One row of something still being browsed. Right edge, non-modal |

- **A form is never a modal.** A dialog is narrower than the screen it covers,
  it traps focus away from the record being described, and a sequence does not
  fit in one. `FormPage` takes `steps` for that, and a step rail offers the
  steps already passed, never the ones ahead.
- **A screen renders a form page instead of its list**, not on top of it, so the
  state belongs to the screen. If the pane you are in is too narrow to hold a
  page, the state is in the wrong component.
- The submit button lives in the page footer, outside the `<form>`, and reaches
  it with `form={id}` from `useId()`.
- A side panel does not trap focus and does not block a click behind it. That is
  the point: the grid it opened from stays usable. A click on that grid also
  closes the panel, the same way Escape does, unless the click is on whatever
  opens or swaps the panel's own content (a row, an "Add" or "Edit" button
  marked `data-opens-panel`) or lands inside a menu, a dialog or another
  popover the screen or the panel opened on top of everything.
- The settings **window** is still modal, for the reason in decision 26. Reading
  a row changes nothing; changing a setting changes what every screen shows.

## 5d. Pages use the width they are given

A page is as wide as the window. There is no reading column and no centred
900px strip: a list, a table, the overview and the template screens fill what is
left of the window after the rail, and a wider window shows more of them.

What keeps a measure is what is read or filled in as a line, never a page:

- Paragraphs of explanation (`max-w-[62ch]`), so a sentence does not run the
  width of a monitor.
- A form page (`FormPage` at its default width, 620px) and a dialog. A field
  stretched across 1600px is harder to use, not easier.
- A popover, a menu, a side panel and a tooltip, which are sized to what is in
  them.

A new page container is `w-full`. `max-w-[var(--content-width)]` is gone from
the tokens, and an arbitrary cap on a page is the thing to take out in review.

## 5e. Motion

Things that arrive are animated, things that are already there are not, and
nothing moves while you are reading it. The tokens are in
`brand/tokens.css`:

| Token | For |
| --- | --- |
| `--duration-fast` 120ms, `--duration-base` 180ms | A hover, a colour, a press |
| `--duration-slow` 360ms | Something arriving: a card, a screen, a panel |
| `--ease` | Colour and the quickest changes |
| `--ease-smooth` | Arrivals. A strong decelerate: fast off the mark, long settle |
| `--ease-spring` | A small thing that should feel like it landed, with a hair of overshoot |

The animations are utilities, not keyframes written at the call site:

| Utility | For |
| --- | --- |
| `animate-screen` | A whole screen, on the `main` that is re-keyed per navigation |
| `animate-rise` | A card, a tile, a row. Stagger a list with `stagger(index)` from `lib/motion.ts`: a 36ms step, and nothing past the tenth |
| `animate-scale` | A dialog, a menu, the palette |
| `animate-slide` | A side panel, from the edge it lives on |
| `animate-lift` | A toast |
| `animate-fade` | A scrim, or content replacing content in place |

- **Transform and opacity only.** An animation that changes height, margin or
  top relayouts the page on every frame. Collapsing a row is the one place a
  size changes, and it is done by animating `grid-template-rows` between `1fr`
  and `0fr`, which the browser does without measuring.
- **A press gives.** Buttons scale to 97% while down, icon buttons to 90%.
- **Numbers count up** (`useCountUp`) the first time they have a value. Once.
- **Loading is the shape of what is coming** (`CardSkeleton`), not the word, so
  the card does not grow under whatever is below it.
- **Reduced motion is honoured in one place.** `global.css` cuts every
  animation and transition to nothing under `prefers-reduced-motion`, and
  `prefersReducedMotion()` is for the code that waits on a delay of its own. A
  new animation needs nothing to opt in.
- The raised side of `SectionSwitch` slides: each side is its own screen, so it
  remembers where it was and the new copy moves from there.

## 5f. The keyboard

`lib/shortcuts.ts` holds every combination as a string (`mod+shift+l`), where
`mod` is Command on a Mac and Control elsewhere. The sheet in
`ShortcutsDialog`, the tooltips and the listener in `app/use-shortcuts.ts` all
read the same strings, so they cannot disagree.

- **Digits are read from the physical key.** On a Belgian AZERTY keyboard the
  unshifted number row types `&`, `é` and `"`, so `event.key` never says "3".
  Punctuation ignores Shift for the same reason: `?` is on a different key on
  every layout. Letters and named keys match Shift exactly.
- **Every shortcut carries the modifier, so it works while typing.** There is no
  bare-key shortcut: the template editors own keys such as `?`, and two
  listeners for one key is a bug that depends on which mounted first.
- **Nothing fires under a dialog**, so a shortcut cannot move you from beneath a
  question that is waiting. The palette is the exception, and its own shortcut
  closes it.
- **"New" asks, and the screen opens its form.** `requestScreenAction` brings the
  screen up fresh and `useScreenAction` in that screen opens its form once it
  has mounted. A screen that can start something adds the hook, and an entry in
  `NEW_ON` in `app/screens.ts` says what the command is called there.
- **The palette adds no capability.** What it opens is what a click opens, through
  the same requests (`requestOpen`, `requestOpenClient`). A command that only
  the palette can do is a feature with one way in.
- A new shortcut goes in `SHORTCUT_GROUPS` in the same commit, or the sheet is
  wrong.

## 6. Numbers line up

`font-variant-numeric: tabular-nums` on **every column of numbers**: amounts,
dates, counts, ids, times, file sizes. The `.tabular` class in the tokens file
exists for this.

Without it, a column of euro amounts is unreadable and a list of dates jitters as
it updates. This is not a preference.

Monospace (`--font-mono`, `font-mono`) is for ids, hashes, code and raw headers.
Not for amounts, which are tabular sans.

## 7. Focus, hit targets, accessibility floor

- **Focus rings are never removed.** Restyle them:
  `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`.
  `outline: none` with nothing in its place is a keyboard user lost on a dense
  table.
- A focus ring must be visible on `--paper`, `--surface` and `--sunken`, in both
  themes. `--focus` is picked to work on all of them; a custom ring colour is not.
- **Minimum hit target is 32x32px** for a dense control inside a row (an icon
  button in a 36px row), and 40x40px for anything standalone: toolbar buttons,
  primary actions, anything in a modal. Pad a small icon out to the target rather
  than growing the icon.
- **One exception, by the owner's choice: the mail template editor.** Its design
  panel, layers and floating toolbar use Figma's sizes, 28px controls and 34px
  tools, because that editor is a canvas tool and is used like one. It does not
  spread: every other screen keeps the targets above.
- Every interactive element is a `<button>` or an `<a>`, never a `div` with
  `onClick`. Icon-only buttons carry an `aria-label`.
- Text contrast at least 4.5:1 against its actual background. `--ink-muted` passes,
  `--ink-faint` does not. Check the pair, not the token in isolation.
- A row that is clickable gets a visible hover (`bg-accent-soft`) and the same
  state on keyboard focus.

## 8. Global CSS stays tiny

`src/styles/global.css` holds the Tailwind import, the tokens import, the
bundled `@font-face` rules for Inter and JetBrains Mono (decision 10, no network
fetch), and base `html`/`body` background, colour and font. Nothing else.

No component classes, no `@apply` chains, no `!important`. Everything else is a
utility class on the element.
