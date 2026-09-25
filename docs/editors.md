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
has a layout.

### With a layout: the canvas

`src/features/templates/mail/canvas/`. The model is sections holding blocks:

| | |
| --- | --- |
| **Frame** | Fixed in width, because a mail body is. 600 pixels is what clients agree on. The height is the canvas the author draws on, and content past it just makes the message longer |
| **Section** | A row down the frame that arranges what is in it with **flexbox** or **grid**: direction, distribution, alignment, gap, wrap, column count |
| **Block** | Text, heading, button, image, spacer, divider, a declared input placed as a block, and raw HTML |
| **Sizing** | `grow`, and nothing else. A block takes its content's width or a share of what is left |

**Nothing is positioned.** There is no `position`, no coordinate, no drag to a
point on the frame. A block is placed by the rules of the section holding it or
it is not placed at all, and a block is moved within its section or dragged into
another one. Custom CSS is allowed per block, per section and per canvas, and
`sanitiseDeclarations` strips the positioning properties out of it, because the
escape hatch must not reintroduce what the model refuses.

`bodyHtml` is compiled from the layout on every save, so the renderer, the
placeholder substitution and the outbox below them never learn that a canvas
exists. The layout is the source; the HTML is output. They cannot disagree,
because one write produces both.

**A declared input can be a block.** An input of kind `image` renders as an
`<img>` around its placeholder rather than as the address in text, which is what
makes a picture something a template can ask for. A `url` input renders as a
link. Everything else renders as its value.

### The Outlook problem, and the decision taken

This compiles to literal `display:flex` and `display:grid`. **Outlook on Windows
renders with Word's engine, which supports neither**, and stacks every section
into a single column with the gaps and the alignment gone.

That is a deliberate choice, not an oversight. The alternative is compiling to
nested tables the way MJML does, which survives Outlook and makes the model
harder to reason about. The editor states the trade-off on the section
inspector, where the choice is made, rather than leaving it to be discovered by
a recipient.

### Without a layout: the HTML

Everything written before the canvas has `layout: null` and keeps the two views
it has always had: **Visual**, a contentEditable surface with a toolbar, and
**Code**, the same string in CodeMirror. Neither is the source of truth over the
other; `bodyHtml` is. Switching between them never rewrites markup nobody
touched.

Converting is a deliberate act. "Lay out on a canvas" puts the existing body in
as one raw block, which the author then breaks into sections. Compiling it into
blocks automatically would rewrite somebody's hand-written table without being
asked. "Keep as HTML" goes back the other way, keeping the HTML the canvas
compiled to.

### The code view stays editable

For a template with a canvas, the Code tab can still be typed in, and "Apply to
canvas" reads the markup back through `layoutFromHtml`. Markup it recognises
comes back as the block it was, carried on `data-juno-*` attributes the compiler
emits. Markup it does not recognise comes back as a **raw block in the position
it was written**, so an edit never loses what somebody typed.

What it cannot promise is byte-identical output for a hand-written document: a
raw block is re-emitted inside the div that holds it, so the structure survives
and the exact spacing does not. The panel under the editor says so in those
words.

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
arrives at several megabytes, and is truncated by some clients. A hosted URL is
the right answer, so the editor offers a URL first.

Only `https:` URLs. Not `http:`, because a mail client that loads one leaks the
recipient's address and IP to anyone on the path. The same rule applies to a
button's target, and a button with no usable target renders as words rather than
as a link that goes nowhere.

### What an agent can do

The same surface, through MCP: `mail.templates.get` and `mail.templates.preview`
are read-only, and `create`, `update` and `hide` park for a person to approve
(decision 24). An agent proposes an edit and a person applies it, which is what
co-editing means here. `update` replaces the whole canvas rather than merging
into it, so the tool description tells a caller to read the template first.

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
