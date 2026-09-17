# Bureau brand

What the product is called, what it sounds like, and how it looks. The tokens
themselves live in [tokens.css](tokens.css); this file is the reasoning behind
them and the rules for using them.

Open [preview.html](preview.html) in a browser to see the whole kit rendered:
swatches, type scale, controls and a dense table, in both themes. It is built
only from the tokens, so if it renders correctly the tokens are correct. Use it
as the check after changing any value.

---

## 1. The name

**Bureau.** A writing desk and an office, in English, Dutch and French at once.
That trilingual overlap is the point: the people this is for are small business
owners in Belgium and around it, and the word needs no translation for any of
them.

It is a plain, real word. That is deliberate. A calm name is the honest signal
for a calm tool, and invented startup names age badly.

- Always capitalised as **Bureau**. Never BUREAU, never bureau mid-sentence.
- No tagline locked to the logo. If a line is needed, write one for the context.
- The app is Bureau. A user's own database is "your bureau", lowercase, only if
  it reads naturally. Do not force it.

## 2. What Bureau is for

One sentence: **Bureau is where the paperwork of running a small business
happens, on your own machine, without a subscription.**

It holds clients, contracts, mail, dates and reminders in one place, generates
the documents you would otherwise retype, and exposes everything it can do to an
AI agent so the boring parts can be asked for rather than clicked through.

## 3. Values

These are decision rules, not decoration. When a design question is genuinely
balanced, the higher value wins.

| Value | What it means in practice |
| --- | --- |
| **Local by default** | The data is a file on the user's disk. Nothing leaves the machine unless the user asked for it, and the app is fully usable with the network off. |
| **You stay in control** | Automation proposes, the user disposes. Nothing is sent, signed, filed or deleted without an explicit confirmation. An agent has exactly the powers a user has, never more. |
| **Quiet** | No badge counts competing for attention, no streaks, no celebration animations, no notification the user did not ask for. The app is calm when there is nothing to do. |
| **Boring on purpose** | This is admin software. Predictable beats clever. A screen that works the same way it did last week is a feature. |
| **One place** | Mail, clients, documents and dates belong to the same record. The value is the connection between them, not any one of them alone. |
| **Free and yours** | No seats, no tiers, no cloud bill. Every record exports to a plain format. Leaving must be easy, or "local-first" is only a slogan. |

## 4. Voice

Plain, short, second person. Say what happened and what to do about it.

- **Write like a competent colleague, not like a brand.** "Two contracts are
  waiting for a signature" beats "You have pending items requiring attention".
- **Never sell inside the product.** The user already has it.
- **Errors name the cause and the next step.** "Could not reach mail.example.com.
  Check the server address in Settings." Not "Something went wrong."
- **Buttons are verbs in sentence case.** "Send reminder", not "Send Reminder",
  not "Submit".
- **Numbers and dates are specific.** "Due 3 October", not "due soon".
- **No exclamation marks.** Anywhere.

The app interface is **English**. Everything generated for a client, meaning
contracts, emails and documents, is **Dutch (Belgium)** by default. Those are two
different registers and they do not share copy.

The full blacklist of phrasing to avoid, which also covers commit messages and
code comments, is in [../.claude/rules/writing.md](../.claude/rules/writing.md).

## 5. Colour

The palette is paper and ink. A warm off-white rather than clinical white, a warm
near-black rather than pure black, and one restrained blue that reads as document
ink. It is meant to be comfortable for hours and to look like a working surface,
not a dashboard demo.

| Role | Token | Use it for |
| --- | --- | --- |
| Window | `--paper` | The application background |
| Card | `--surface` | Panels, rows and cards sitting on paper |
| Well | `--sunken` | Table headers, inset areas, empty regions |
| Text | `--ink` | Primary text and icons |
| Secondary text | `--ink-muted` | Labels, metadata, timestamps |
| Faint | `--ink-faint` | Decorative and large text only. Never body copy |
| Borders | `--line`, `--line-strong` | Dividers, then inputs and emphasis |
| Accent | `--accent` | Links, the primary action, the selected state |
| Seal | `--seal` | Signed, sealed, completed. The one warm note |
| Status | `--ok`, `--warn`, `--risk` | Plus their `-soft` background tints |

Rules:

- **Never a raw hex in a component.** A colour the design needs and the theme
  lacks is a token to add, not a value to inline.
- **The accent is rare.** One primary action per screen. If three things on a
  screen are accent coloured, none of them is primary.
- **The seal is rarer still.** It marks a finished, signed thing. Using it for
  general decoration spends its meaning.
- **Status colour is never the only signal.** Colour plus an icon or a word, so
  the meaning survives a colour-blind user and a greyscale print.
- Every pair in `tokens.css` has been checked against WCAG AA in both themes.
  Changing a colour means re-running that check, not eyeballing it.

## 6. Typography

**Inter** for the interface, **JetBrains Mono** for identifiers, amounts in dense
tables, and code. Both are bundled with the app rather than fetched, because an
offline-first application cannot depend on a font CDN.

- Default interface text is **14px**. This is a dense data application, not a
  marketing page. Table rows drop to 13px, badges to 11px.
- One `--text-h1` per screen at most. Most screens need none.
- `--leading-relaxed` is for long-form reading only: a document preview or the
  body of an email. Interface text uses `--leading-normal`.
- **Every column of numbers gets `tabular-nums`.** Amounts, dates and counts that
  do not line up are unreadable at a glance, which is the only way anyone reads
  a table.

## 7. Shape, depth and motion

- **Radius is small.** 4px on inputs, 6px on buttons and rows, 10px on cards. The
  `--radius-full` token is for avatars and nothing else.
- **Borders do the work, not shadows.** Shadow is reserved for things that
  genuinely float above the page: popovers and modals. A card with a drop shadow
  on a flat list is noise.
- **Motion is fast and unshowy.** 120ms to 180ms, ease out. Animate opacity and
  transform, nothing else. No bounce, no spring, no page transition.
- Respect `prefers-reduced-motion` by dropping to an instant state change.

## 8. The logo

Files live in [logo/](logo/). The mark is a **B** built from a spine and two
drawer blocks, so it reads as a letter and as a desk at the same time. It holds
down to 16px, which is the only size test that matters for an app icon.

| File | Use |
| --- | --- |
| `bureau-mark.svg` | The mark alone, `currentColor`. Inline in the app |
| `bureau-wordmark.svg` | Mark plus name, `currentColor`. Inline in the app |
| `bureau-wordmark-ink.svg` | Fixed dark. For light backgrounds and any `<img>` |
| `bureau-wordmark-paper.svg` | Fixed light. For dark backgrounds and any `<img>` |
| `bureau-icon.svg` | The rounded accent tile. Application and installer icon |
| `favicon.svg` | The tile at 32px, with tightened proportions |

**The trap, which has already been hit once:** an SVG loaded through an `<img>`
tag renders in its own document, so `currentColor` resolves to black no matter
what the surrounding page does. The `currentColor` files only work when the SVG
is inlined in the markup. Anywhere an `<img src>` or a Markdown image is
involved, reach for the `-ink` or `-paper` variant instead.

Other rules:

- Clear space around the mark is the width of its spine on every side.
- Never recolour the mark outside the palette, never add a gradient, never add a
  shadow, never stretch it, never outline it.
- On a photograph or a busy background, use the `bureau-icon.svg` tile rather
  than the bare mark.
- The wordmark files still carry live text. Outline it before the wordmark is
  used anywhere outside the app, or it will render in a fallback face on a
  machine without Inter. Marked `TODO(asset)` in those files.

## 9. What Bureau does not look like

Worth naming, because these are the defaults that creep in:

- Not a dark neon dashboard. No cyan on near-black, no purple to blue gradient,
  no glow.
- Not a consumer app. No illustrations of people, no rounded pill buttons, no
  confetti, no mascot.
- Not an enterprise suite. No dense chrome, no ribbon, no nested grey toolbars.
- No gradient text, no generic drop shadow under everything, no stock hero image.
