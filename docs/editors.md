# The editors

Three editing surfaces, and they are deliberately not the same thing. A note is
typed prose. A mail template is a canvas that compiles to HTML somebody else's
mail client has to render. A document template is a page that will be printed
and signed. Treating those as one editor is what produces a tool that is bad at
all three.

---

## 1. Notes: live Markdown

`src/components/MarkdownEditor.tsx`.

One surface, not a split pane. The styling is applied while typing, and the
markup characters are hidden on every line the cursor is not on. This is how
Obsidian behaves, and it is built on CodeMirror 6 for the same reason Obsidian
is: hiding and revealing ranges as the selection moves needs a decoration
model, and a `contenteditable` with a Markdown parser bolted to it does not
have one.

Read-only rendering stays `src/components/MarkdownNotes.tsx`. A note is short
typed text, so raw HTML in it is still left as plain text.

## 2. Mail templates: a canvas, or the HTML under it

`src/features/templates/MailTemplateEditor.tsx`, over the model in
`electron/shared/types.ts` (`MailLayout`) and the compiler in
`electron/main/services/mail-layout.ts`.

A template is edited one of two ways, and which one it is depends on whether it
has a layout. A new template starts with one: the plus on the list opens into a
name field, Enter creates the template with that name as its subject too (a
template cannot be saved without one), and the editor opens on an empty canvas.

### The shape of the editor

It is the shape every canvas tool has, because the job is the same one, and it
fills the screen with nothing over the canvas. The breadcrumb in the title bar
is the way back, and so is Escape once nothing is selected; the first Escape
lets go of the selection, because a canvas with a block selected is not a page
somebody is trying to walk out of. That is still a page in the sense of
decision 30: it replaces the list and offers a way back, it is only not drawn
with `FormPage`'s header, because a bar over a canvas is room the canvas needs.

| | |
| --- | --- |
| **Left** | The name, the description and the subject, each edited where it is written rather than in a box; the subject wraps and Enter leaves it. The layers, which are also where order is changed. Autosave and Save at the foot. It folds away to a bar over the canvas with the name in it |
| **Middle** | The sheet, drawn at the width of the breakpoint being edited, with its name and size over it, on a surface that scrolls and pans (space or the middle button) and zooms (Ctrl and the wheel, the buttons, or the keys below). It opens zoomed to fit, and a click on the empty surface round it lets go of what is selected. Below it, a handle that makes the sheet taller and never shorter than its content |
| **Bottom** | A toolbar floating over the canvas, the way Figma's does. On the left, everything that can go in a message, as glyphs with their names and keys in the tooltips; a new block lands straight after the selected one, at the end of the selected section, or in the last section showing. On the right, in a group of their own, the four views: the canvas, the message as it will be sent, the HTML, and what the template asks for. At the end, the list of keyboard shortcuts |
| **Right** | The design panel, in Figma's order, for the frame, a section or a block: breakpoints, position, layout, appearance, typography, fill, stroke, effects. Its choices are icons with the words in the tooltips, its colours are Figma's rows with a picker behind the swatch, and its controls are Figma's size, 28 pixels |

### The model

The model is sections holding blocks:

| | |
| --- | --- |
| **Frame** | The whole message. It **fills** the reader's mail client, or is **fixed**: never wider than its width and in the middle of a wider client. The width is also what the default is drawn at, 600 until somebody changes it. Its height is the sheet the author draws on, and content past it just makes the message longer |
| **Section** | A row down the frame that arranges what is in it with **flexbox** or **grid**: flow (down, across or a grid), distribution, alignment, gap, wrap, column count. One narrower than the frame sits at its start, in its middle or at its end, by its margins. An empty one with a height and a fill, or a stroke on one side, is a divider or a gap |
| **Block** | Text, sent as a paragraph; heading, button, image, a declared input placed as a block, and code. There is no divider or spacer to add, because a section is both; the ones older templates have still load and still send |
| **Sizing** | Figma's three, for the width and the height each: **fixed**, **hug** and **fill**. A fixed width is compiled with `max-width:100%` so it still gives way on a phone, and a fixed height is a least height the content can grow past. Clip content |
| **Alignment** | Where a block sits across its section, start, middle or end, overriding the section's own alignment. It moves a block across the flow and nowhere else. Stretching is not an alignment: it is a fill |
| **Hidden** | Figma's eye. A hidden block or section stays in the layers and is left out of the message |

**Nothing is positioned.** There is no `position`, no coordinate, no rotation
and no drag to a point on the frame. A block is placed by the rules of the
section holding it or it is not placed at all. Order is changed by dragging, on
the canvas or in the layers, where a section can be dragged too, and Alt with an
arrow moves the focused layer one place. Custom CSS is allowed per block,
per section and per canvas, and `sanitiseDeclarations` strips the positioning
properties and `transform` out of it, because the escape hatch must not
reintroduce what the model refuses.

`bodyHtml` is compiled from the layout on every save, so the renderer, the
placeholder substitution and the outbox below them never learn that a canvas
exists. The layout is the source; the HTML is output. They cannot disagree,
because one write produces both.

The panel's order is Figma's. **Position** is the alignment row, the three
across and the three down, with the ones that do not apply in the section
greyed out as Figma greys them in an auto layout; there is no X or Y because
nothing is placed at a point. **Layout** is W and H, each with fixed, hug or
fill in the field beside the number, then the corner radius, one or four, the
padding, as two numbers or four, and clip content. **Appearance** is whether it
shows and its opacity. Then **Typography** for anything with words,
what a button links to or a picture shows, and **Fill**, **Stroke** and
**Effects** as rows, each with its eye and its minus.

The model has no field called fill or hug. It has what CSS has, a block's own
width and least height, its share of the room along the section (`grow`) and
where it sits across it (`alignSelf`), and which of those a mode means depends
on which way the section runs. `sizing.ts` works it out once, for the panel and
the keyboard both:

| Section runs | Width fill | Width hug | Height fill | Height hug |
| --- | --- | --- | --- | --- |
| Down | Stretched across | Not stretched | A share of the room | No share |
| Across | A share of the room | No share | Stretched down | Not stretched |
| Grid | The cell's width | Not offered | Stretched down | Not stretched |

W and H in the panel always say how big the block is drawn, measured on the
canvas, the way Figma's do; typing a number into either makes that side fixed,
and switching to fixed starts from the size it is drawn at. A button and a
picture are added hugging, because in a section that stretches what is in it a
button would otherwise be a bar the width of the message. A section added from
the toolbar has 24 pixels of room round what goes in it. The one a hand-written
body moves into has the room the house frame used to give it, 32 by 36, so it
does not lose its margins by being sent without that frame.

**The canvas draws every block as the element the message carries.** The
section's flex or grid lays out the heading, the div, the link or the picture
itself, with the canvas's handlers and outline on it, not on a box around it.
A box around it is what the section would stretch, and the selection would
outline the room the block was given rather than the block: a text block fixed
at 100 pixels was drawn as a line across the frame. Only a code block keeps an
element of the canvas's own round it, because its markup is set inside one, and
that element takes the code's placement and width so the two agree.

The canvas is drawn in the app's own document, where the app's reset has taken
the size off every heading, the margin off every paragraph and the colour off
every link. A mail client has none of that, so the canvas puts back what a
client's own stylesheet gives (`CLIENT_DEFAULTS` in `canvas/box-style.ts`,
reverting to the browser's defaults, which is what a client starts from). A
heading with no size of its own is drawn large on the canvas because it is sent
large.

**A declared input can be a block.** An input of kind `image` renders as an
`<img>` around its placeholder rather than as the address in text, which is what
makes a picture something a template can ask for. A `url` input renders as a
link. Everything else renders as its value.

### Code blocks: "Convert to HTML"

There is no raw HTML block to add. Any block can be converted instead: "Convert
to HTML" at the foot of the design panel turns it into the HTML and CSS it
compiles to, and from then on the panel shows that block as two fields of code,
HTML and CSS, and none of the design controls. Nothing about how it looks
changes, and a test holds that to the byte: compiling the converted block gives
the markup the original gave. The conversion runs in the main process
(`convertBlockToCode` in services/mail-layout.ts, through
`mail.templates.convertBlock`), so the code is what the compiler writes rather
than a second copy of it, and like `parseBody` it stores nothing: it is part of
the draft until the template is saved.

The CSS is declarations for the element itself when the HTML is one element,
and for a div around it when it is more than one, and that is the one rule the
compiler, the canvas and the code view all follow. The HTML may carry an email's
structure, headings, tables, pictures and links, and goes through
`sanitiseMarkup`, which is stricter about what runs than it is about what is
shown: scripts, styles, frames and forms go with what is inside them, every
handler goes, and an address that is not https or mailto goes.

The code view is where a code block also comes from: markup it cannot place
comes back as one, in the position it was written. A block made before blocks
were code, a raw block with a box around it, loads as a code block whose CSS is
that box, around a div holding its markup, which is exactly what it compiled to.

### Appearance

Figma's fill, stroke, corners, opacity and effects, as far as a mail client
renders them, and each one that a common client ignores says so where it is
set.

| | Compiles to | Where it does not show |
| --- | --- | --- |
| **Fill** | A solid colour, or a two-stop linear gradient written as `background-image` over its first stop as a flat `background-color` | Outlook on Windows paints the flat colour instead of the gradient |
| **Stroke** | A width, a colour, solid, dashed or dotted, on every side as one `border` or on the sides chosen as `border-top` and the rest | |
| **A colour's opacity** | The percentage beside the hex, kept as `#rrggbbaa` and written as `rgba()` after the same colour solid | Outlook on Windows paints the colour solid |
| **Corners** | One radius, or four | Outlook on Windows draws square corners |
| **Opacity** | `opacity` | Outlook on Windows |
| **Effects** | Drop shadow and inner shadow as one `box-shadow`, layer blur as `filter` | Outlook on Windows draws neither |
| **Selection colours** | Every colour in what is selected; changing one changes it everywhere in the selection | |

A fill, a stroke and each effect has Figma's eye, which keeps it in the panel
and leaves it out of the message. A colour is a row: the swatch, the six digits
and the opacity, each typed, and the swatch opens the picker beside the panel,
with saturation and brightness in the square, hue and opacity on the sliders,
and for a fill the choice of solid or linear and the gradient's two stops. It
is not a dialog: a press anywhere else closes it, and so does Escape, before
the editor sees the key.

Left out on purpose: background blur (`backdrop-filter`, which no client on the
list renders), blend modes, layout guides, and export. An effect nothing
applies is an effect that lies about what the message will look like.

The sheet is white and set in the message's own ink and type in both themes,
through `--canvas-paper`, `--canvas-ink` and `--canvas-line`, which are fixed
on purpose. A preview in the application's dark ink would be unreadable on it
and would not be what the recipient opens.

### Typography

Figma's type panel, bar the OpenType features, which no mail client applies:
family, nine weights from thin to black, size, line height, letter spacing,
horizontal and vertical alignment, italic, underline, strikethrough, and case.
An empty size or line height is the message's own, 15 and 1.65.

Bold, italic, underline, strikethrough and links inside a text block are edited
on the canvas: a double click opens the block in place, in its own type, with a
format bar over it, and so do Enter on a selected block and adding one, which
open it with its words selected so that what is typed replaces them. Inside it,
Ctrl+B, Ctrl+I and Ctrl+U work on the words as everywhere else; on a block that
is selected and not open, they set the whole block. What the
browser writes (a `<div>` per new line, `<strike>`) is cleaned into the set a
text block keeps by `inline-html.ts` before the compiler's sanitiser sees it.
A heading is edited in place as plain text.

A family is one of three kinds:

- **The message's own**, Inter with its system stack, which is what a block with
  no family is set in.
- **One every client has**: Arial, Helvetica, Verdana, Tahoma, Trebuchet MS,
  Georgia, Times New Roman, Courier New. No link needed.
- **A linked font**, declared on the frame under Fonts or straight from the
  family picker. A Google font is named; anything else, Adobe, Bunny, Fontshare
  or a server of the business's own, is an https stylesheet link. Each one names
  a fallback, sans, serif or mono, and is written into every block that uses it
  as `'Family', <fallback stack>`, because Gmail and Outlook on Windows load no
  web fonts at all. The stylesheets go in the head of the message.

The canvas shows a Google font and not a linked one, and decision 36 says why.

### The keyboard

Figma's keys, from one table in `canvas/shortcuts.ts` that the editor, the
stage, the tooltips and the list on the toolbar all read, and that a test holds.
A key typed into a field belongs to the field, except Ctrl+S, and Escape, which
leaves the field first. On a focused button, Enter, Tab and the arrows keep
what the button does with them.

| | |
| --- | --- |
| **Add** | F section, T text, H heading, B button, I image, E input |
| **Edit** | Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y), Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D, Delete or Backspace, Ctrl+Shift+H to hide or show, Ctrl+S |
| **Select** | Enter opens a text or steps into a section, Shift+Enter goes up to the section, Tab and Shift+Tab step through the layers beside it, Escape lets go |
| **Arrange** | An arrow moves what is selected one place earlier or later; Alt with A, H, D or W, V, S aligns it across its section |
| **Text** | Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X, and Ctrl+Alt with L, T, R or J for the text alignment |
| **View** | Ctrl+= and Ctrl+-, Shift+0 for 100%, Shift+1 to fit, space to pan, ? for the list |

The zoom keys are taken before the window's own, which would scale the panels
along with the sheet. A paste lands where a new block would; what was copied is
kept for the session, so a block copied in one template pastes into the next.

**Undo is the canvas's.** Every change to the layout goes through one function
that keeps the one before it, a hundred deep. A change to what is in the
sections and in what order is always a step of its own; a change to how
something looks is merged with the one before it when it is to the same
selection and within 800 milliseconds, so a word typed into a field or a colour
dragged across the picker is one step. The name, the subject and the other
fields keep their own undo, the browser's. Going to or from hand-written HTML is
not a step and clears it.

### Breakpoints

Figma's breakpoints, at the top of the design panel. Default is the design
itself, what the CSS says with no media query round it, so it has no width of
its own: the canvas draws it at the frame's width, which is set on the frame.
Every other row is a width at and below which the message looks different,
with its name, which a double click renames, its width and its minus. Pressing
a row draws the canvas at that width, and what is changed from then on changes
there.

A breakpoint starts as a copy of the widths above it and holds only what is
changed at it, keyed by the id of the section or block
(`MailBreakpoint` in electron/shared/types.ts). What changes is how something
looks and where it sits: size, sizing, alignment, padding, fill, stroke,
effects, type, whether it shows, a section's flow. What something says, where
it links and what it shows are the same at every width, so an edit to the
words made at a breakpoint goes to the default. Anything a breakpoint has not
changed follows the default, and a narrower breakpoint starts from the wider
ones, because that is how `max-width` media queries stack in a client.

The panel is handed the canvas as the breakpoint draws it and changes that, the
same as on the default, and `canvas/breakpoints.ts` compares the result with
what the wider widths make of it: the difference is what this breakpoint
changes. The compiler (`breakpointCss` in services/mail-layout.ts) writes each
breakpoint as a media query in the head of the message, widest first, as the
declarations that differ, `!important` because an inline style gives way to
nothing else, with a reset for anything the breakpoint takes away. An element
hidden by default and shown at a breakpoint is sent with `display:none` and
`mso-hide:all` for the media query to lift. Outlook on Windows reads no media
queries and shows the default, which the panel says.

The preview view looks at the message at the same breakpoints, so the media
queries in it are the ones being edited.

### What is sent

A message laid out on the canvas is sent as the canvas and nothing else:
`canvasShell` in services/mail-html.ts writes the document with the viewport,
the fonts and the breakpoints in its head, the message's own type on a wrapper,
and the canvas. No tinted page, no card, no accent line, no footer. Whatever the
author wants around the message is on the canvas, and the business details
that used to be the footer are a section like any other. A hand-written
template, and a plain message typed in the composer, still go in the house
shell, which gives them the card and the footer they were written to sit in.
Decision 37.

### The Outlook problem, and the decision taken

This compiles to literal `display:flex` and `display:grid`. **Outlook on Windows
renders with Word's engine, which supports neither**, and stacks every section
into a single column with the gaps and the alignment gone.

That is a deliberate choice, not an oversight. The alternative is compiling to
nested tables the way MJML does, which survives Outlook and makes the model
harder to reason about. The editor states the trade-off on the section panel,
where the choice is made, rather than leaving it to be discovered by a
recipient.

### Without a layout: the HTML

Everything written before the canvas has `layout: null` and keeps the editing it
has always had in the same frame: the **Body** view is a contentEditable surface
with a toolbar, and **Code** is the same string in CodeMirror. Neither is the
source of truth over the other; `bodyHtml` is. Switching between them never
rewrites markup nobody touched.

Converting is a deliberate act, at the foot of the layers. "Lay this out on a
canvas" puts the existing body in as one code block, which the author then
breaks into sections. Compiling it into blocks automatically would rewrite
somebody's hand-written table without being asked. "Turn the whole template into
hand-written HTML" goes back the other way, keeping the HTML the canvas compiled
to. That is the whole template; "Convert to HTML" in the design panel is one
block.

The register (u or je) is no longer offered in the editor. The column stays on
the row, the shipped templates carry one, and nothing reads it to decide
anything.

### The code view stays editable

For a template with a canvas, the Code view can still be typed in, and "Apply to
canvas" reads the markup back through `layoutFromHtml`. Markup it recognises
comes back as the block it was, carried on `data-juno-*` attributes the compiler
emits, with every appearance and type setting read back into its control rather
than into custom CSS. Markup it does not recognise comes back as a **code block in
the position it was written**, so an edit never loses what somebody typed. The
fonts and the breakpoints are not in the markup, which is only the body, so they
come across from the canvas, and so does the width a filling frame is drawn at.

What it cannot promise is byte-identical output for a hand-written document: a
code block is re-emitted through the sanitiser, attributes in its own order, so
the structure survives and the exact spacing does not. The bar under the code
says so in those words.

### Saving

Manual, with a switch for autosave. Autosave waits for a pause of 1.5s, saves
anyway once an edit is 15s old so steady typing still gets written, and does
nothing when nothing changed.

The last of those three is the one that matters. The editor this replaced had no
dirty check and previewed by saving, because `mail.templates.render` could only
read a saved row. So it wrote on a timer whether anything had changed or not,
and every write stamped `customisedAt`, which marked shipped templates as edited
that nobody had touched. `mail.templates.preview` renders values in hand, so a
preview is a read again.

### Images in an email

An email that carries its images as base64 is an email that gets filed as spam,
arrives at several megabytes, and is truncated by some clients. So an image is
an address and nothing else: there is no upload and no `data:` source, and the
compiler refuses one.

Only `https:` URLs. Not `http:`, because a mail client that loads one leaks the
recipient's address and IP to anyone on the path. The same rule applies to a
button's target and to a link typed on the canvas, and a button with no usable
target renders as words rather than as a link that goes nowhere.

### What an agent can do

The same surface, through MCP: `mail.templates.get` and `mail.templates.preview`
are read-only, and `create`, `update` and `hide` park for a person to approve
(decision 24). An agent proposes an edit and a person applies it, which is what
co-editing means here. `update` replaces the whole canvas rather than merging
into it, fonts and appearance included, so the tool description tells a caller
to read the template first. Loading a Google font for the canvas is not a tool,
and decision 36 says why.

## 3. Document templates: a page, not a textarea

`src/features/templates/DocumentTemplateEditor.tsx`, over the model in
`electron/shared/types.ts` (`DocumentLayout`) and the compiler in
`electron/main/services/document-layout.ts`.

The model is what a PDF is: pages, a margin, and two ways to place something.

| | |
| --- | --- |
| **Pages** | Explicit. Adding a page adds a page, and content does not silently reflow onto a page the author did not ask for |
| **Margin** | One margin for the whole document, in mm, drawn as a guide |
| **Flow** | Blocks stacked down the column inside the margin. Text, headings, lists, tables, images, spacers, rules |
| **Boxes** | A block pinned to a position on the paper, measured from the paper's corner, painted over the flow. An address block in a window envelope's window is a box |

`bodyHtml` is compiled from the layout on every save, so the renderer, the
placeholder substitution and `printToPDF` below it never learn that a page
editor exists. The layout is the source; the HTML is output. They cannot
disagree, because one write produces both.

A template written before this editor existed has `layout: null` and is edited
as HTML. That stays supported. Converting one is a deliberate act, because
compiling a hand-written contract into blocks would lose whatever the author
did by hand.

### What the editor must not pretend

It is not Word. There is no text wrap around an image, no columns inside a
flow, no styles panel with forty controls. The block set above is the set.

Content that overruns its page is shown as overrunning, with a warning saying
which page. Silently clipping it would put a clause off the bottom of a signed
contract, and silently reflowing it would move the signature block.

## 4. Declared inputs, and using a template

A template asks for what the records cannot answer. An input is a key, a
label, a kind, and whether it is required. The key becomes the placeholder:
an input keyed `scope` is written `{{document.scope}}` in the body.

Using a template is its own screen, not a dialog, because it is a form with a
sequence in it (rule 5c, decision 30):

1. **Fill.** The declared inputs, with their labels and their help text.
2. **Link.** A client, a project, or nobody. This is what fills `{{client.*}}`.
3. **Create.** A mail template becomes a draft in the outbox. A document
   template becomes a PDF on disk and a record pointing at it.

Nothing is sent or filed by that screen. A draft still goes through the outbox
gate, and a document still has to be signed by a person
([.claude/rules/mcp.md](../.claude/rules/mcp.md) section 4).

Clicking a template in a list shows a preview, not the editor. Reading is the
common case; editing is the rare one.

## 5. A document is a PDF

Only PDFs. Two ways in:

- **Generated** from a template. The PDF is written at generation, not later,
  so a document record always points at a file that exists.
- **Imported.** An existing PDF copied in, with no template and no body. The
  copy is what Juno holds; the original is never moved or deleted.

Either can be opened, reviewed and signed. An imported PDF cannot be
re-rendered, and the service refuses rather than writing an empty page over it.
