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

The palette is cool porcelain with a deep **iris** accent and a **brass** second
note. Iris carries every interactive state. Brass is signed and sealed only, and
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
- Motion is `--duration-fast` (120ms) or `--duration-base` (180ms) with `--ease`.
  Transitions on `transform`, `opacity` and colours only, never on layout
  properties. An app people use all day should not animate at you.
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
- Sidebar is `--sidebar-width` (248px), collapsed to `--sidebar-rail-width`
  (56px), titlebar `--titlebar-height` (40px). All three are tokens because other
  things are measured against them, and because the title bar height is also the
  height of the native caption-button overlay
  ([architecture.md](architecture.md) section 4b).
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

## 5b. The sidebar has three states, and the window picks two of them

`src/app/use-sidebar-layout.ts` owns this, and a screen never second-guesses it.

| Window width | Behaviour |
| --- | --- |
| >= 1100px | Beside the content, expanded. The toggle collapses it to a rail |
| 760 to 1100px | The same, but a rail by default. A 248px sidebar is a third of the screen here |
| < 760px | Out of the layout. The toggle floats it over the content as a drawer |

The drawer closes on Escape, on a click outside, and when something in it is
chosen. Widening the window past 760px puts the sidebar back and closes the
drawer, so a panel is never left hanging over the content.

Collapsed means icons only: the label moves into `aria-label` and `title`, and a
group heading becomes a hairline rather than an abbreviation. Every entry keeps
its 36px row height in both states, so nothing jumps when it toggles.

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
  the point: the grid it opened from stays usable.
- The settings **window** is still modal, for the reason in decision 26. Reading
  a row changes nothing; changing a setting changes what every screen shows.

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
