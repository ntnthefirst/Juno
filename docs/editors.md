# The editors

Three editing surfaces, and they are deliberately not the same thing. A note is
typed prose. A mail template is HTML that has to survive Outlook. A document
template is a page that will be printed and signed. Treating those as one
editor is what produces a tool that is bad at all three.

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

## 2. Mail templates: HTML that has to survive a mail client

`src/features/templates/MailTemplateEditor.tsx`.

Two views over one document, and both are the same HTML:

- **Visual.** What the message will look like, edited in place.
- **Code.** The same HTML as text, for the cases where the visual editor is in
  the way. CodeMirror 6 again, with the HTML grammar.

Switching between them never changes the HTML on its own. A round trip through
the visual editor that rewrites the markup is a bug: somebody's hand-written
table is not ours to reformat.

The preview is the real thing, rendered through `mail.templates.render` so it
goes through `mailShell` and shows the house footer, in a sandboxed frame with
an empty `sandbox` attribute. What the editor shows and what the client gets
are the same bytes.

### Images in an email

An email that carries its images as base64 is an email that gets filed as
spam, arrives at several megabytes, and is truncated by some clients. A hosted
URL is the right answer, so the editor offers a URL first.

Embedding a local file is still allowed, because sometimes there is nowhere to
host it. It asks first, in those words: it says the message gets bigger, that
some clients refuse it, and that a URL is the better answer. Per image, every
time. No remembered consent.

Only `https:` URLs. Not `http:`, because a mail client that loads it over plain
HTTP leaks the recipient's address and IP to anyone on the path.

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
