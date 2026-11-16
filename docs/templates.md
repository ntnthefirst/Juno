# Writing a mail template

A mail template is a message laid out once and sent many times, from Styled
mail. Templates live in the database and are edited in the app, not on disk.
The canvas they are laid out on is in [editors.md](editors.md) section 2.

**There are no document templates any more** (decision 82). A document made
from one earlier stays an ordinary document: it opens, previews and prints the
body it was made with. One made from a template nobody reviewed is a
**specimen**, recorded on the document itself: its PDF carries a red banner,
the audit page of a signature repeats the warning, and the service refuses to
sign it. Write the contract with your own checked text as a new document and
sign that.

---

## Syntax

Four forms, and deliberately no more. A message needs substitution and "leave
this line out when there is no value". Anything beyond that is a programming
language inside a letter.

| Form | Does |
| --- | --- |
| `{{ document.contact_name }}` | The value, HTML-escaped |
| `{{& document.contact_name }}` | The value, raw. Opt in, and rarely the right answer |
| `{{#if document.reference }} … {{/if}}` | Include when present and not empty |
| `{{#unless document.reference }} … {{/unless}}` | The mirror of `if` |

Whitespace inside the braces is ignored, so `{{document.title}}` and
`{{ document.title }}` are the same thing.

### Three behaviours worth knowing

**Everything is escaped by default.** A value of `<script>` or one
containing markup becomes text, not markup. Use `{{& … }}` only for a value you
control and that is genuinely meant to be HTML.

**A missing value is printed, not skipped.** `{{ document.iban }}` with no
value renders a red marked box reading `[ontbreekt: document.iban]`. This is
deliberate: a blank space gets sent, and a marked gap gets questioned, and a
message with one is refused. Wrap the line in `{{#if …}}` when the value is
genuinely optional.

**A canvas cannot use the raw form.** The canvas escapes an ampersand on its
way into the message, so `{{& … }}` is never recognised there. Plain values and
conditions work in every template; the raw form only in one written as HTML.

## What a mail template prints

**A mail template fills in only what it asks for** (decision 47). Nothing from
a client, a project or your settings reaches it. Every value it prints is one
of its own inputs,
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

## What a signature is worth

A signature is a PNG, a timestamp and a SHA-256 of the exact bytes that were
signed, plus an audit page stating all of it. That is appropriate for low-stakes
and internal documents.

It is **not** a qualified electronic signature under eIDAS, the audit page says
so in plain Dutch, and anything where that distinction matters should go through
a provider that offers one. See decision 8.
