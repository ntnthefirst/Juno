# Writing a document template

A template is the legal text with placeholders in it. The body is HTML, per
[decision 19](decisions.md). Templates live in the database and are edited in the
app, not on disk.

**Nothing that ships is fit to send to anyone.** A new install gets one example
template and no other, and it is a specimen until you have read it and marked it
as reviewed. An install that still has the five older invented templates
(`nda`, `development_agreement`, `hosting_agreement`, `project_scope`,
`addendum`) keeps them, and they are just as unfit. See
[../TODO.md](../TODO.md) item 1.

---

## What ships

One example on a first install, and nothing else. It is laid out on two pages
with a heading, a list, a table, the client's address pinned to the paper and two
signature blocks. It uses a value, a condition and its negation, and asks for
three values when it is used (what is being done, how it is paid, and the payment
term in days). It is written in Dutch with "u", it is an ordinary template you can
edit or delete, and it starts unreviewed like every template.

An install that has the five older templates keeps them exactly as they are, and
a new one never gets them. Nothing may look a template up by key, because most
installs will not have the one you want.

## A template on paper

A new template is laid out on the canvas, on paper of a fixed size
([editors.md](editors.md) section 3, decision 41), and it works differently
from everything below in one way: **it fills in only what it asks for.** None
of the `owner.*`, `client.*`, `project.*` or `document.*` values listed under
"Available values" reach it. Every value it prints is one of its own inputs,
written `{{document.<key>}}`, typed by a person or an agent when it is used. A
placeholder naming anything else is refused when the template is saved, with a
message saying which. The conditionals still work on inputs:
`{{#if document.vat}}...{{/if}}`.

So if a document should carry the client's name, give it an input for the
name. The PDF is then made before anybody chooses a client, and choosing one
only decides where the document is kept.

A picture the template always carries, a logo or a signature line, is added on
the canvas and kept as a file; it is written `{{asset.<key>}}` as an image's
source and you never type that yourself. A picture that changes each time is an
input of kind image, chosen from a file when the template is used.

An agent has the same surface: `templates.create` and `templates.update` take a
`canvas` and `inputs`, `templates.add_image` stores a picture, `templates.fill`
checks the values against a canvas without storing anything,
`templates.import_docx` reads a Word file, and `documents.generate` makes the
document for a client from `extras`. Everything that writes parks for a person
to approve.

## Syntax

Four forms, and deliberately no more. A contract needs substitution and "leave
this paragraph out when there is no VAT number". Anything beyond that is a
programming language inside a legal document.

| Form | Does |
| --- | --- |
| `{{ client.name }}` | The value, HTML-escaped |
| `{{& client.name }}` | The value, raw. Opt in, and rarely the right answer |
| `{{#if client.vatNumber }} … {{/if}}` | Include when present and not empty |
| `{{#unless client.vatNumber }} … {{/unless}}` | The mirror of `if` |

Whitespace inside the braces is ignored, so `{{client.name}}` and
`{{ client.name }}` are the same thing.

### Three behaviours worth knowing

**Everything is escaped by default.** A client called `<script>` or a note
containing markup becomes text, not markup. Use `{{& … }}` only for a value you
control and that is genuinely meant to be HTML.

**A missing value is printed, not skipped.** `{{ client.iban }}` with no IBAN
renders a red marked box reading `[ontbreekt: client.iban]`, on the page and in
the PDF. This is deliberate: a blank space in a contract gets signed, and a
marked gap gets questioned. Wrap the paragraph in `{{#if …}}` when the value is
genuinely optional.

**A page layout cannot use the raw form.** A layout escapes an ampersand on its
way into the page, so `{{& … }}` is never recognised there. Plain values and
conditions work in every template; the raw form only in one written as HTML.

## Available values

### `owner.*`

From **Settings → Your details**. Fill that in before generating anything.

`businessName`, `contactName`, `email`, `phone`, `vatNumber`, `iban`,
`addressLine1`, `addressLine2`, `postalCode`, `city`, `country`

`contactName` falls back to `businessName` when it is empty, so a sentence
addressing a person stays grammatical.

### `client.*`

`name`, `email`, `phone`, `website`, `vatNumber`, `addressLine1`,
`addressLine2`, `postalCode`, `city`, `country`

Plus, from the client's **primary** contact: `contactName`, `contactRole`,
`contactEmail`. A client with no primary contact leaves these empty, which is why
the signature block wraps them in `{{#if …}}`.

### `project.*`

Only when a project was chosen. Empty otherwise, so guard with `{{#if project.name}}`.

| Path | Note |
| --- | --- |
| `name`, `description` | As entered |
| `startsOn`, `dueOn` | Already formatted `14/11/2026` |
| `agreedValue` | Already formatted `€ 2 100,00` |
| `agreedValueCents` | The raw integer, if you need arithmetic in prose |

### `document.*`

`title`, `issuedOn` (formatted), `issuedOnIso` (`YYYY-MM-DD`), plus anything
typed into the extra fields when generating, such as `changeSummary` on an
addendum.

## Formatting is done for you

Dates arrive as `14/11/2026` and money as `€ 2 100,00`, in Belgian convention
with a non-breaking thousands space. Do not reformat them in the template, and
do not do arithmetic on `agreedValueCents` in prose: money is integer cents
everywhere for a reason.

## Styling

The print stylesheet is in `electron/main/services/document-style.ts` and is
applied to every document. It is **not** the application's theme tokens: a
contract is printed in ink on paper and has to look the same whether Juno is
running in dark mode or not.

Classes worth using:

| Class | For |
| --- | --- |
| `juno-clause` | A clause that should not be split across a page break |
| `juno-parties` | The `<dl>` holding the two parties |
| `juno-doc-meta` | Small grey line under the title |
| `juno-signatures`, `juno-signature` | The signature block at the end |

`h2` never breaks away from the text under it, so a clause heading cannot be
orphaned at the foot of a page.

## The specimen flag

A template with no `reviewedAt` is a specimen. That is the state every template
starts in, the example included, and it has teeth:

- Every document generated from it carries `isSpecimen`, recorded **on the
  document**, so reviewing the template later cannot silently reclassify a
  contract that has already gone out.
- The PDF prints a red banner on it, from the shell rather than from any
  template, so it cannot be edited out by accident.
- The audit page on a signed specimen repeats the warning.

**Editing a template's body clears its review flag** and bumps its version.
Reviewing is a claim about the content, so it has to be made deliberately and
never as a side effect of an edit.

## What a signature is worth

A signature is a PNG, a timestamp and a SHA-256 of the exact bytes that were
signed, plus an audit page stating all of it. That is appropriate for low-stakes
and internal documents.

It is **not** a qualified electronic signature under eIDAS, the audit page says
so in plain Dutch, and anything where that distinction matters should go through
a provider that offers one. See decision 8.

## Mail templates

A mail template uses the same syntax and works like a template on paper:
**it fills in only what it asks for** (decision 47). None of the values under
"Available values" reach it. Every value it prints is one of its own inputs,
each with a key, a label, a kind and whether it is required, written
`{{document.<key>}}`. A placeholder naming anything else is refused when the
template is saved. The canvas it is laid out on is in
[editors.md](editors.md) section 2.

So a greeting is an input (`{{document.contact_name}}`, "Aanspreking"), and so
is a footer line. An input can carry a starting value, which is how a footer
with your own details fills itself in every time. Choosing a client when the
template is used decides who it goes to and where it is filed, and fills in
nothing.

A template written before this read records. It is converted the first time
Juno starts after the change: `{{client.contactName}}` becomes
`{{document.client_contact_name}}` and an input labelled "Client contact name",
and an `owner.*` value starts with what your settings said at that moment.

**What ships.** One example on a first install, and nothing else. An install
that already has the four old mail templates keeps them; a new one never gets
them, and no code looks a mail template up by key.

Two things to know when writing one:

- An input that is printed and left empty is a gap, and a message with a gap
  is refused. Wrap an optional line in `{{#if document.<key>}}` and mark its
  input not required.
- Conditionals do not nest. The first closing tag ends the conditional it
  meets, so an `if` inside an `if` leaves the outer one open. Give each
  optional line its own.
