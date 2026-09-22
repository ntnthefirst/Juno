---
name: template-new
description: Add a document or email template to Juno - a .docx contract with docxtemplater placeholders, or an HTML email template. Covers placeholder naming, which client fields are actually available, the Dutch-language requirement for anything a client sees, and rendering a preview before a template is ever used on a real document or sent. Use when the user says "add a contract template", "I need an email template for X", "the offer letter should be a template".
---

# Workflow: a new template

**Follow [CLAUDE.md](../../../CLAUDE.md) and [.claude/rules/](../../rules/)
throughout, [writing.md](../../rules/writing.md) in particular.** This file is
how a template gets added so it renders, reads like a person wrote it, and is
looked at before anyone sends it.

Two kinds, same rules for placeholders and language:

| Kind | Format | Engine | Lives in |
| --- | --- | --- | --- |
| **Document** (contract, offer, agreement, letter) | `.docx` | docxtemplater, then `printToPDF` or pdf-lib for the signed version | `templates/documents/<name>.docx` |
| **Email** (proposal mail, reminder, follow-up) | HTML | the HTML template renderer, sent with nodemailer | `templates/email/<name>.html` |

Both are registered in the templates service so the screen and the agent can list
them. A file on disk that nothing registers does not exist.

---

## Step 1 — Decide which it is, and confirm the scope

A document is a file the owner keeps, sends and possibly signs. An email is a
message body. If the answer is "both", it is two templates, and the email one
attaches the document.

Scope check before writing a word: Juno does **no invoicing**
([decisions.md](../../../docs/decisions.md), 9). A payment reminder that points
at an invoice made elsewhere is fine. A template that numbers or issues an
invoice is not, and the answer is the accounting tool.

Legal text check: the signing Juno does is a signature image plus a timestamp
plus an audit trail. That is **not a qualified electronic signature under
eIDAS**, and no template may say or imply it is
([decisions.md](../../../docs/decisions.md), 8). No "rechtsgeldig gekwalificeerde
handtekening" in a footer.

## Step 2 — Know which fields exist before writing placeholders

```bash
grep -rn "sqliteTable" db/schema/clients.ts db/schema/documents.ts
grep -rn "export type" electron/main/services/templates.ts
```

The template can only use what the render context actually passes. Read the
service, do not guess from the screen. The context is built from real rows:

- **`client.*`** from the clients table: the name, the contact person, the
  address parts, the email, the VAT number, and whatever else that table holds
  today. Check the schema for the exact column names, and use those names.
- **`document.*`** the document's own fields: its title, its reference, its
  dates.
- **`owner.*`** the business details of the owner, from settings.
- **`today`** and any other date, **already formatted for display** by the
  service, in Belgian format. A template never formats a date and never does
  arithmetic.

A field the template needs and the context lacks is a service change first, then
the template. Never a hardcoded value, and never an invented field name that
silently renders empty.

## Step 3 — Placeholder naming

Same rules in both formats. docxtemplater uses `{ }`; the HTML renderer uses the
same names.

- **`object.field`**, lowercase, dot separated: `{client.name}`,
  `{client.vat_number}`, `{owner.address_city}`, `{document.reference}`.
- **The field name matches the database column**, so a reader can grep for it.
  No aliases, no prettier synonym.
- **Loops** are `{#items}` ... `{/items}`, over a list the service passes. No
  logic beyond a loop and a presence condition.
- **Optional blocks** use a presence condition: `{#client.vat_number}BTW
  {client.vat_number}{/client.vat_number}`. A missing optional field must
  disappear cleanly, not leave a dangling label, a stray comma, or an empty line
  in an address block.
- No placeholder inside a Word field, a content control or a tracked change.
  docxtemplater will not see it, or will see it split across runs. Type it as
  plain text, in one go, in one formatting run.
- Every placeholder in the file appears in the render context, and every context
  field is either used or deliberately unused. An unmatched placeholder ships as
  literal braces in a contract someone signs.

## Step 4 — Write the content, in Dutch

**Anything a client sees is Dutch.** Contracts, offers, letters, email bodies,
subjects, button labels inside an email, the PDF footer. This is not
negotiable and it is not a translation of an English draft
([writing.md](../../rules/writing.md)).

- Natural, idiomatic Belgian Dutch. Not translated-sounding, not Dutch from the
  Netherlands where the Belgian word differs.
- Short, direct sentences. Say what the thing is and what happens next.
- **No AI tells**: no em or en dashes as sentence connectors, no "ontdek", no
  "naadloos", no "dé oplossing", no rule-of-three filler, no Title Case on
  ordinary labels, no curly quotes. The grep sweep in
  [writing.md](../../rules/writing.md) runs over `templates/` too.
- **Legal text is not written from scratch and not paraphrased.** Clauses come
  from the owner's existing contracts. Anything missing gets a `TODO(copy)` with
  a note saying what clause is needed, never a plausible invention. A wrong
  clause in a signed contract is worse than an obvious gap.
- Fixed text stays in the template. Nothing client-facing is assembled from
  fragments in TypeScript.

`.docx` specifics: keep the document's existing Word styles, since the file has
to stay editable in Word by a non-developer. Do not restructure the layout while
adding placeholders.

HTML email specifics: tables for layout, inline styles, no external stylesheet,
no web font, no remote image. **No tracking pixel, ever.** A plain-text
alternative goes with it. Max width around 600px, and it has to be readable when
images are blocked.

## Step 5 — Register it and expose it

Add the template to the templates service so it can be listed, previewed and
rendered: id, human name in Dutch, kind, file path, and the context type it
needs. Then the thin adapters, both of them: the IPC channel and the MCP tool
([mcp-tool-new](../mcp-tool-new/SKILL.md)). A template the agent cannot render
is a template that only half exists.

Rendering writes a file, so it is side-effectful. Preview is read-only.

## Step 6 — Render a preview, before it is ever used

**No template goes near a real client until a rendered preview has been looked
at.** Not the source file, the rendered output.

- [ ] Render against a **real client row** (a copy, not a live edit), not a row
      of filler. Filler hides the long company name and the missing VAT number.
- [ ] Render again against a client with **every optional field empty**. No
      literal `{client.vat_number}`, no dangling "BTW", no blank line where an
      address line should be, no double comma.
- [ ] Open the `.docx` in Word: styles intact, no placeholder survived as text,
      page breaks land where they should, the signature block is on a page with
      text above it.
- [ ] For the PDF path, render through `printToPDF` and read the whole thing.
- [ ] For an email, look at the HTML preview in the app **and** send one test to
      the owner's own address. With images blocked, it still reads.
- [ ] Read the Dutch out loud once. That catches the translated-sounding
      sentences nothing else does.

Sending to an actual client is the owner's action and needs confirmation
([mcp.md](../../rules/mcp.md)). This skill never sends anything outward.

## Step 7 — Commit

Per [git.md](../../rules/git.md). Template plus its registration in one commit.

```bash
git add templates/documents/samenwerkingsovereenkomst.docx electron/main/services/templates.ts
git commit -m "Add collaboration agreement template"
```

A `.docx` is a binary: check the diff is one file and that no rendered output,
no test PDF and no real client data got staged with it. **Never commit a
signature image.** Plain human subject, no AI attribution.

## What this skill does

- Puts `.docx` contracts and HTML emails in the right place with a consistent
  placeholder convention.
- Uses only fields the render context really passes, named after the columns.
- Writes client-facing copy in Dutch, with legal clauses taken from the owner's
  existing text.
- Registers the template through the service and both adapters.
- Requires a rendered preview, including the all-optional-fields-empty case,
  before any real use.

## What this skill does NOT do

- It doesn't send anything to a client.
- It doesn't write or paraphrase legal clauses that don't already exist.
- It doesn't claim the signature is a qualified electronic signature.
- It doesn't add invoicing, invoice numbering or payment instructions.
- It doesn't put tracking pixels, remote images or web fonts in an email.
