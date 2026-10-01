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

`src/features/templates/CanvasTemplateEditor.tsx`, over the model in
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
| **Bottom** | A toolbar floating over the canvas, the way Figma's does. On the left, the five groups of everything that can go in a message (Containers, Text, Columns, Media, Other), as glyphs with their names and keys in the tooltips. A group is a button that adds the element it added last, with a chevron beside it that opens the group's menu ("The toolbar's groups" below). A new element lands inside the selected container or cell, or straight after the selected element; with nothing selected, a container or columns table goes at the end of the frame and anything else at the end of the last container showing. On the right, in a group of their own, the four views: the canvas, the message as it will be sent, the HTML, and what the template asks for. At the end, the list of keyboard shortcuts |
| **Right** | The design panel, in Figma's order, for the frame, a container, a columns table, a cell or a block: breakpoints, position, layout, spacing, appearance, typography, fill, stroke, effects, actions. Its choices are icons with the words in the tooltips, its colours are Figma's rows with a picker behind the swatch, and its controls are Figma's size, 28 pixels |

### The toolbar's groups

What is added is that HTML element, so the layers and the code view name it for
what it is, and its tag is changed afterwards in the design panel, within its
group, the way a heading's level is changed.

| Group | Elements | Written as |
| --- | --- | --- |
| **Containers** | Section, div, header, footer, main, article, aside, nav | The tag itself, laying out what is in it the way a section does. Each holds blocks and other containers |
| **Text** | Heading 1 to 6, text (`p`), quote (`blockquote`), preformatted (`pre`), address, inline text (`span`), bulleted list (`ul`), numbered list (`ol`), button | The tag itself. Bold, italic, underline and links stay inside the text, on the format bar. A list's words are its `li` items, one line each. A button is a text with a fill, a radius, padding and an empty on-click link, styled like the button block it replaces ("Actions" below) |
| **Columns** | A table laid out for mail | `table role="presentation"`, rows and cells, below |
| **Media** | Picture (`img`), linked picture (`img` inside an `a`) | A linked picture is a picture with an on-click link, and one whose link has no usable address is a plain picture. Video, audio and embeds are not offered: they play in no client that matters, so the menu says so instead, and a video is a picture that links to where it plays |
| **Other** | Divider (`hr`), input (a declared input) | As they always were |

**The keys.** One scheme, from one table (`canvas/elements.ts`) that the
toolbar, its menus, the shortcut table and the list of shortcuts all read:

- A group's own letter adds the element it added last, which is remembered per
  machine in local storage like the autosave switch: **F** containers, **T**
  text, **C** columns, **I** media, **E** other.
- **Shift with the group's letter** opens its menu, and the focus goes into it.
  In an open menu an element's own key adds it, with Shift still held or not;
  the arrows walk the rows, Enter presses the focused one and Escape closes it.
  Containers: **S** section, **D** div, **H** header, **F** footer, **M** main,
  **A** article, **I** aside, **N** nav. Text: **1** to **6** for the heading
  levels, **P** text, **Q** quote, **R** preformatted, **A** address, **S**
  inline text, **U** bulleted list, **O** numbered list, **B** button. Columns:
  **C**. Media: **I** picture, **L** linked picture. Other: **D** divider, **I**
  input.
- **H** adds a heading 2, as it always has. **B** used to add a button block on
  its own; the button is an element of the Text menu now, so a bare **B** adds
  nothing.

Each element's key is in its menu row and in the list of shortcuts. A test
holds that every element has a key, that no key is used twice in a group, and
that no key means two things: a bare letter adds, Shift with one opens a menu,
Alt aligns and Ctrl with Alt aligns text, and none of those overlap. As
everywhere in this editor, a letter typed into a text belongs to the text.

**A section is written as `<section>`** in the sent HTML, with `display:block`
on it because some older clients style unknown block elements oddly. That
includes every section in a version 1 layout, which compiled to a `div` before
version 2. A `div` added from the Containers group stays a `div`. Every other
container is written as its own tag. The compiler writes `display:block` first
on every container that is not a `div`, ahead of the layout's own
`display:flex` or `display:grid`: a client that knows the element but not
flexbox keeps the block, and one that knows neither still gets a block rather
than an inline box.

**Columns** are a table because a table is the one layout Outlook on Windows
keeps side by side. A table has rows and a row has cells. A cell has a width,
a percentage of the table or empty to share what is left, a vertical
alignment and a box of its own, and holds blocks, containers and other tables
the way a container does. The gap is written as padding on the inner sides of
the cells, because `border-spacing` is unreliable in mail. A new table is one
row of two cells at half each, each holding a text, so there is something to
type into. Rows and cells are added and taken away in the design panel, and a
row of even widths stays even.

### The model

The model is a tree (`MailNode` in `electron/shared/types.ts`, version 2). A
container holds an ordered list of children, each one a container, a columns
table or a leaf block, so a section can hold another section, and any of them
can hold a columns table. A columns table holds rows of cells, and a cell
holds children the same way a container does. Ids stay stable through all of
this, which is what lets breakpoints and drags address a node at any depth.

| | |
| --- | --- |
| **Frame** | The whole message. It **fills** the reader's mail client, or is **fixed**: never wider than its width and in the middle of a wider client. The width is also what the default is drawn at, 600 until somebody changes it. Its height is the sheet the author draws on, and content past it just makes the message longer. Any node may sit at its own top level |
| **Container** | What every section has always been, generalised to nest and to be any of eight tags: it arranges what is in it with **flexbox** or **grid**, flow (down, across or a grid), distribution, alignment, gap, wrap, column count. One narrower than its parent sits at its start, in its middle or at its end, by margins in the frame or a table cell and by `grow`/`alignSelf` when it is nested inside another container's flex or grid, the way a block sits in a section. An empty one with a height and a fill, or a stroke on one side, is a divider or a gap. A version 1 section loads as a container tagged `section` |
| **Columns** | A table laid out for mail, the one layout that stays side by side in Outlook on Windows ("The Outlook problem" below). Its cells hold children the way a container does; a cell has no eye of its own, because it is fixed in place by its row rather than something that is added or removed |
| **Block** | Text, sent as the tag it has (a paragraph, a quote, a list and so on); heading, h1 to h6; image; a declared input placed as a block; the divider (`hr`); and code. A button is a text with an on-click action; the button blocks older templates have still load, compile and edit, and are simply not offered. There is no spacer to add, because a container is one; the ones older templates have still load and still send |
| **Sizing** | Figma's three, for the width and the height each: **fixed**, **hug** and **fill**. A fixed width is compiled with `max-width:100%` so it still gives way on a phone, and a fixed height is a least height the content can grow past. Clip content. `sizing.ts` only ever looks at the one container a block actually sits in, never at where that container itself sits, so a block nested three levels deep resizes exactly the way a top-level one does |
| **Alignment** | Where a block sits across its own parent, start, middle or end, overriding that parent's own alignment. It moves a block across the flow and nowhere else. Stretching is not an alignment: it is a fill |
| **Hidden** | Figma's eye. A hidden container, columns table or block stays in the layers and is left out of the message |
| **Actions** | What a click or a hover does, on any node including a cell: `actions`, empty by default, and a saved layout without it reads as empty ("Actions" below) |

**Nothing is positioned.** There is no `position`, no coordinate, no rotation
and no drag to a point on the frame. A node is placed by the rules of the
parent holding it or it is not placed at all. Order is changed by dragging, on
the canvas or in the layers: into a container or a cell, in front of a sibling,
or out of one into its own parent, and Alt with an arrow moves the focused
layer one place within its parent. Custom CSS is allowed per block, per
container, per columns table and per canvas, and `sanitiseDeclarations` strips
the positioning properties and `transform` out of it, because the escape hatch
must not reintroduce what the model refuses. A move that would nest a
container into itself, into its own descendant, or past the parser's own
depth limit is refused outright (`canMoveInto` in `canvas/canvas-actions.ts`),
the same way the parser refuses to read a layout that deep.

**Selecting and entering.** A click selects whatever element is directly under
the pointer, at whatever depth that is: every node's own handler stops the
click before it reaches an ancestor's, so a block nested inside two containers
is selected in one click, never its parent first. A double click on a
container, a columns table or a cell that is already selected steps into it
and selects its first child, the way Figma's frame does when there is nothing
exposed to click directly; a double click on a text block or a heading opens
it for typing, as it always has.

**What the design panel gives each kind**, the same at any depth:

| | |
| --- | --- |
| **Container** | Its element (the tag), position (where it sits and its size), layout (flow, alignment, gap, wrap, columns of a grid, clip), spacing (padding and margin), appearance (the eye, radius, opacity), fill, stroke, effects, actions, breakpoints, and conversion to HTML. Inside a flex or grid parent its position is that parent's cross axis and its share of the room is a block's, worked out by `sizing.ts`; in the frame or a table cell, which lay things out in plain flow, it is margins, and there is nowhere to move until it is narrower than what holds it |
| **Columns** | Its name, position and width, layout (the gap), spacing, appearance with the eye, fill, stroke, effects, actions, then its rows and the cells in each (add and remove), and conversion to HTML |
| **Cell** | Position (its width, a percentage or empty), layout (vertical alignment and clip), padding, radius and opacity, fill, stroke, effects and actions. No eye of its own, no margin (a `td` ignores one) and nothing to drag, because its row fixes it in the table. Removing it is in its header |
| **Block** | As before, and for a text or heading its element (any tag of the Text group), and actions for every kind, a code block included. In the frame or a cell a block is sized fixed or filling (a picture or a button fixes or hugs instead), with no share of the room and no alignment but a picture's. A text, heading, button or input has a Layout of its own: how its words sit (see below). No block has Clip content |

What something is written as and what a table holds are the same at every
width: a tag, a row, a cell, a cell's width and alignment, and the gap change
the stored canvas whichever breakpoint is being looked at, and only how
something looks goes to the breakpoint. Between a text and a heading the
element changes kind: a text made a heading keeps its words as plain text, a
heading made a text gets them back escaped, and between a list and a text the
items become lines and back.

`bodyHtml` is compiled from the layout on every save, so the renderer, the
placeholder substitution and the outbox below them never learn that a canvas
exists. The layout is the source; the HTML is output. They cannot disagree,
because one write produces both.

The panel's order is Figma's, and it is the same for every kind of element. A
section an element has nothing for is left out, never shown empty.

| Section | Holds |
| --- | --- |
| **Position** | Where the element sits in its parent, and how big it is. The alignment row, the three across and the three down, with the ones that do not apply in the parent greyed out as Figma greys them in an auto layout; there is no X or Y because nothing is placed at a point. Then W and H, each with fixed, hug or fill in the field beside the number: sitting and sizing in the parent are one question |
| **Layout** | Only how the element arranges what is in it. For a container: the flow (down, across or a grid), Figma's 3 by 3 alignment box, the gap with its Auto, wrap for a row or a column and the column count for a grid, and Clip content. For a columns table: the gap between cells. For a cell: its vertical alignment and Clip content. For a text, heading, button or input, which lay out words rather than children: the horizontal alignment (left, centre, right, justify) and, for a text or a heading that is not a list, the vertical one |
| **Spacing** | Padding, then margin. Each is across and down as two numbers, or each side on its own behind the button beside them. A cell has padding only |
| **Appearance** | The eye, then the corner radius and the opacity on one row, with the button that gives each corner a radius of its own |
| **Typography** | For anything with words: family, weight, size, line height, letter spacing, italic, underline, strikethrough, case and the colour |
| **Fill**, **Stroke**, **Effects** | As rows, each with its eye and its minus |
| **Actions** | Rows like the effects: a trigger, what it does, the eye and the minus ("Actions" below) |
| The kind's own | What a button block links to, what a picture shows, which input an input is, a columns table's rows. Then the selection colours and the custom CSS |

**The alignment box** is two questions asked with one click: where the content
sits across the page (left, centre, right) and where down it (top, middle,
bottom). The model asks them the way CSS does, along the flow and across it, so
`alignment.ts` maps the box on to the fields by the way the container runs: in
a row, left to right is `justify` and top to bottom is `align`; in a column it
is the other way round; in a grid, across is `justify` (which writes
`justify-items`) and down is `align`. Four values are not a place in the box
and stay reachable:

- **Stretch** is a toggle beside the box, "Stretch across" and "Stretch down".
  A flex container can stretch across its flow, a grid both ways. A stretched
  axis lights the line of places the other axis picks, and a click on the box
  takes the container out of stretch, since the click chooses a place.
- **Space between and space around** are the gap's Auto. The gap field has a
  choice beside it, Fixed, Auto (space between) and Around (space around), the
  way W and H have theirs. Around is Juno's own; Figma has no name for it. While
  the gap is Auto or Around a click on the box changes only the other axis,
  the way Figma's box does. Choosing Fixed packs the content at the start.

Opening the panel never rewrites anything: the box is read from the fields and
only a click writes.

A grid used to have only `align`. It now has `justify` as well, stretch by
default, which is what a grid without it always did and writes nothing, so a
saved grid compiles to the same bytes. Where a grid does not stretch its items
across their cells they are as wide as their content, so a block in it can be
fixed or hug there and not fill.

**Margin** is new in the model: `box.margin`, zero on every side, so every saved
template reads as it did (the parser gives a missing one zeros, and no version
bump was needed). The compiler writes it after the element's own placement, one
side at a time and only where it is set, as `margin-top` and the others, since a
text already carries `margin:0` and a picture `margin:0 auto`. A side the
element's alignment already sets to `auto` keeps that: a container or columns
table in the frame or a cell that is centred or pushed to the end, and a picture
that is centred or pushed right. The panel shows that side as Auto and takes no
number there. A cell takes no margin, because a `td` ignores one. Breakpoints
override it like any other box field, `RESET` puts a side back to zero, and the
code view reads it back. Outlook on Windows drops margins on a `div` in some
versions, and the Spacing section says so.

The model has no field called fill or hug. It has what CSS has, a block's own
width and least height, its share of the room along the section (`grow`) and
where it sits across it (`alignSelf`), and which of those a mode means depends
on which way the section runs. `sizing.ts` works it out once, for the panel and
the keyboard both:

| Section runs | Width fill | Width hug | Height fill | Height hug |
| --- | --- | --- | --- | --- |
| Down | Stretched across | Not stretched | A share of the room | No share |
| Across | A share of the room | No share | Stretched down | Not stretched |
| Grid | The cell's width | Not offered, unless the grid does not stretch across its cells; then hug and not fill | Stretched down | Not stretched |

A container or a columns table sizes the same way, by the parent it sits in.
The frame and a table cell are not flex or grid boxes: they lay what is in them
out in plain flow, one under the next, so there is no share of the room and no
alignment to take. In them a width is fixed or fills (a picture or a button
fixes or hugs instead), a height is a least height, and only a picture, or a
container or table narrower than what holds it, moves across by its margins.

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
handler goes, and an address that is not https, mailto or tel goes.

It works on a container and on a columns table as well: the element and
everything in it become one code block of the markup it compiles to, and the
canvas draws that exactly as it drew the tree. A descendant that is hidden is
left out, because hidden is "not in the message" and this is the message; what
a breakpoint changed about anything under it goes with the structure it was
keyed to, and whether the element itself shows at a breakpoint is kept.

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

### Actions

The button leaves the toolbar, and every element gets an **Actions** section
after Effects: rows like the effects, each with a trigger, what it does, an eye
and a minus. An email can do two things when somebody interacts with it, and
this is both of them.

| Trigger | What it can do | Compiles to | Where it works |
| --- | --- | --- | --- |
| **On click** | Open a link, start a mail, call | The element wrapped in an `<a>`, or an `<a>` itself for an inline text | Every client |
| **On hover** | Change the fill, the text colour, the underline or the opacity | A `:hover` rule in the head, next to the breakpoints, `!important` like them | Apple Mail, iOS Mail and Outlook on the web. Not Gmail, not Outlook on Windows; the panel says so under the rows |

An on-click action has a kind and a target: the address after `https://`, an
email address, or a phone number. The compiler builds `https://...`,
`mailto:...` or `tel:...` from it and runs the result through `safeHref`, which
keeps those three and refuses everything else, `http`, `javascript` and `data`
included; a phone number is digits, spaces and `+ - ( )` and nothing more, and
is sent without its spaces. A target that makes no usable address sends the
element without a link, the way a button with no target was sent as words. A
hidden action compiles to nothing.

- **One click per element.** The Add menu stops offering it once there is one.
  A hover row is one change, and an element has at most one row for each kind
  of change.
- **A link cannot hold a link.** An element with an on-click action around it or
  inside it cannot get one, and the panel says so in one line instead of
  offering it. A stored layout that has both keeps the outer action; the parser
  drops the inner one, and the compiler does the same for a layout handed to
  it directly. A button block is a link through its own `href`, so it takes
  hover rows and no click. A text that is a link as a whole is sent without the
  links it holds in its own words.
- **The link is the wrapper.** A block is wrapped in `<a href style="display:block;
  text-decoration:none;color:inherit">`, or `display:inline-block` for a picture
  that hugs its own width and an input that is text. An inline text (`span`)
  is the `<a>` itself, carrying the span's markers and style. A container, a
  columns table and a cell are wrapped the same way (a cell inside its `td`,
  because a `td` cannot sit in an anchor). The wrapper is marked
  `data-juno-link`, and the code view reads it back into an on-click action on
  the element inside. It takes over the element's `flex` and `align-self`,
  because in a flex or grid parent the wrapper is what is laid out; a
  breakpoint that changes those on a linked element changes the element and not
  its wrapper. Outlook on Windows makes only the text inside a link clickable,
  not the whole box, and the row says so for anything but a picture or an
  inline text.
- **Hover is written once, for every width.** The rules come out of the place
  the breakpoints do (`breakpointRules`), after their media queries, as
  `.jb-<id>:hover{...!important}` on the class the breakpoints already give an
  element; a fill writes `background-color` and `background-image` as the fill
  compiler does, a solid one clearing any gradient under it. A rule can never
  contain an angle bracket. What is converted to HTML loses its hover rows, the
  way it loses its breakpoints; the code view gets them back from the canvas it
  came from, by id, because the markup cannot carry them.
- **A picture links the same way.** What used to be its `href` is an on-click
  action now: a stored `href` is read into one, the field is gone, and the
  linked picture in the Media group adds a picture with an empty link. The
  canvas marks an element with an on-click action with a link glyph in the
  layers. It draws the default look; the preview shows the hover, because it
  renders the message as it will be sent.
- **Actions are content.** They are the same at every width, like a tag, so
  they change the stored canvas and never a breakpoint (decision 37).

**No custom JavaScript.** Not a choice Juno gets to make: every mail client
removes `<script>` and every `on*` handler before the reader sees the message,
Gmail and Outlook drop the whole element, and mail with scripts in it scores as
spam. `sanitiseMarkup` strips them for that reason, and a test holds that a
code block's `onclick` and its `<script>` do not survive. Focus, scroll and
timed triggers need a script, so the two triggers above are the whole of what
an email can do. There is no script field, and a code block cannot carry one.

### Typography

Figma's type panel, bar the OpenType features, which no mail client applies:
family, nine weights from thin to black, size, line height, letter spacing,
italic, underline, strikethrough, and case. How the words sit in their block,
across and down, is in Layout. An empty size or line height is the message's
own, 15 and 1.65.

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

**A picture at a web address is treated the same way.** The window loads images
from Juno and nowhere else (`img-src` in `windows/chrome.ts`), and that is not
loosened for a logo, so the canvas does not try. It draws a box at the picture's
width with its alt text and a line saying that the reader's mail client loads it
and Juno does not (`RemoteImage.tsx`); only a `data:` or Juno's own address is
drawn as a picture. A code block on the canvas gets the same box in place of an
`img`, and every preview frame does too: `framed` in `canvas/framed-preview.ts`
swaps each remote `img` in the rendered message for a box that keeps its style
(`remote-image.ts`), the way received mail is shown without its remote images
(security.md section 4). It changes what is shown and never what is sent.

### The keyboard

Figma's keys, from one table in `canvas/shortcuts.ts` that the editor, the
stage, the tooltips and the list on the toolbar all read, and that a test holds.
A key typed into a field belongs to the field, except Ctrl+S, and Escape, which
leaves the field first. On a focused button, Enter, Tab and the arrows keep
what the button does with them.

| | |
| --- | --- |
| **Add** | F containers, T text, C columns, I media and E other add what the group added last; H heading, B button. Shift with F, T, C, I or E opens the group's menu, where each element has a key of its own ("The toolbar's groups") |
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
changed at it, keyed by the id of the container, columns table, cell or block
(`MailBreakpoint` in electron/shared/types.ts). What changes is how something
looks and where it sits: size, sizing, alignment, padding, fill, stroke,
effects, type, whether it shows (every kind but a cell, which has no eye), a
container's flow, a cell's box. A table's gap and a cell's width and
alignment are structure, and the same at every width. What something says, where
it links, what it does when it is clicked or hovered and what it shows are the
same at every width, so an edit to the words made at a breakpoint goes to the
default. Anything a breakpoint has not
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
the row, the older templates carry one, and nothing reads it to decide
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
button's target, to an on-click link and to a link typed on the canvas, which
may also be `mailto:` or `tel:`, and an element with no usable target renders
as words rather than as a link that goes nowhere.

### What ships

Nothing is seeded into the list of mail templates any more, bar one example on
a first install. The four that used to ship (`contract_cover`,
`project_kickoff`, `invoice_due`, `hosting_renewal`) are gone from the code. An
install that has them keeps them as they are; a new install never gets them, and
nothing may look a template up by key, since most installs will not have it.

The example is one canvas template, in Dutch with "u", that shows one of each
part of this editor, so opening it teaches the canvas: a header with a logo at
a web address and a Google font on its heading, rich text with bold, italic, a
link and a placeholder, a picture the template asks for (a declared image input
placed as a field block), two columns across that stack at the Phone
breakpoint, a columns table, a divider, a gradient, a drop shadow, rounded
corners, a colour with an opacity, a text set up as a button with an on-click
link and a hover colour, a code block, and a footer with the business details
as placeholders. Its first paragraph says it is an example to adapt.

It is written once, by `ensureMailTemplatesSeeded`, on a first install: the
settings file has never seeded the set and the table has no row in it at all,
deleted and hidden rows included. It goes through `create`, so it is an
ordinary template and not a system row. Editing it stamps nothing that an
upgrade reads, deleting it is a delete, and no upgrade or launch brings it back.
Because a canvas is sent with nothing around it, the footer is the business
details the house shell used to add; conditionals do not nest in the template
syntax, so each optional line has its own.

The example's picture input declares an address as its starting value, and both
the editor's preview and the Use screen start an input from the value its
template declares, so the picture has an address before anyone types one.

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

A new template does not: the plus on the list opens into a name field, Enter
creates the template with that name and one empty page as its layout, and it
opens straight into the page editor on that page rather than into the
plain-HTML mode above.

### What the editor must not pretend

It is not Word. There is no text wrap around an image, no columns inside a
flow, no styles panel with forty controls. The block set above is the set.

Content that overruns its page is shown as overrunning, with a warning saying
which page. Silently clipping it would put a clause off the bottom of a signed
contract, and silently reflowing it would move the signature block.

### What ships

Nothing is seeded into the list of document templates any more, bar one example
on a first install. The five that used to ship (`nda`, `development_agreement`,
`hosting_agreement`, `project_scope`, `addendum`) are gone from the code. An
install that has them keeps them as they are; a new install never gets them.

The example is one page-model template in Dutch with "u", laid out on two pages:
headings, a list, a table, the client's address pinned to the paper, and both
signature blocks pinned side by side at the foot of the second. It asks for
three inputs, a textarea, a choice and a number. It is unreviewed, so a document
made from it carries the specimen banner.

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
