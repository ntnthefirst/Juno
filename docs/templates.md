# Writing a document template

A template is the legal text with placeholders in it. The body is HTML, per
[decision 19](decisions.md). Templates live in the database and are edited in the
app, not on disk.

**The templates that ship are invented and are not fit to send to anyone.** See
[../TODO.md](../TODO.md) item 2.

---

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

### Two behaviours worth knowing

**Everything is escaped by default.** A client called `<script>` or a note
containing markup becomes text, not markup. Use `{{& … }}` only for a value you
control and that is genuinely meant to be HTML.

**A missing value is printed, not skipped.** `{{ client.iban }}` with no IBAN
renders a red marked box reading `[ontbreekt: client.iban]`, on the page and in
the PDF. This is deliberate: a blank space in a contract gets signed, and a
marked gap gets questioned. Wrap the paragraph in `{{#if …}}` when the value is
genuinely optional.

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
contract is printed in ink on paper and has to look the same whether Bureau is
running in dark mode or not.

Classes worth using:

| Class | For |
| --- | --- |
| `bureau-clause` | A clause that should not be split across a page break |
| `bureau-parties` | The `<dl>` holding the two parties |
| `bureau-doc-meta` | Small grey line under the title |
| `bureau-signatures`, `bureau-signature` | The signature block at the end |

`h2` never breaks away from the text under it, so a clause heading cannot be
orphaned at the foot of a page.

## The specimen flag

A template with no `reviewedAt` is a specimen. That is the state every shipped
template starts in, and it has teeth:

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
