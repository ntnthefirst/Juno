import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { seededColumns, standardColumns } from "../columns";
import { clients, projects, referenceItems } from "./clients";

/**
 * A template is the legal text with placeholders in it. The body is HTML, per
 * decision 19: a `.docx` cannot become a signed PDF without an external
 * converter, and there is not going to be one.
 */
export const documentTemplates = sqliteTable(
	"document_templates",
	{
		...standardColumns,
		...seededColumns,
		/** Stable machine key: nda, development_agreement, hosting_agreement. */
		key: text("key").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		/** Client-facing output is Dutch. See .claude/rules/writing.md. */
		language: text("language").notNull().default("nl-BE"),
		bodyHtml: text("body_html").notNull(),
		/**
		 * The page model the editor works on: pages, a margin, and the blocks
		 * inside them. `bodyHtml` is compiled from this on every save, so the
		 * render and PDF path below this never has to know the editor exists.
		 *
		 * Null means the template predates the page editor, or was written as HTML
		 * on purpose. Those are edited as HTML and still render.
		 */
		layoutJson: text("layout_json"),
		/**
		 * The values this template asks for when it is used, beyond what the client
		 * and the project already answer. JSON array of input declarations.
		 */
		inputsJson: text("inputs_json"),
		/**
		 * Null means nobody has checked this text is legally sound. The templates
		 * that ship are invented, so every one of them starts null and the app says
		 * so wherever it matters. Set when the owner has rewritten and checked it.
		 */
		reviewedAt: text("reviewed_at"),
		/** Bumped on every body edit, and copied onto each generated document. */
		version: integer("version").notNull().default(1),
	},
	(t) => [
		index("document_templates_key_idx").on(t.key),
		index("document_templates_owner_idx").on(t.ownerId),
		index("document_templates_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A document is one generated instance. It keeps its own copy of the rendered
 * body, because a contract has to still read the way it read when it was sent,
 * even after the template it came from is edited.
 */
export const documents = sqliteTable(
	"documents",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		projectId: text("project_id").references(() => projects.id),
		templateId: text("template_id").references(() => documentTemplates.id),
		/** The template version this was rendered from, for the audit trail. */
		templateVersion: integer("template_version"),
		title: text("title").notNull(),
		statusId: text("status_id").references(() => referenceItems.id),
		/** The rendered body, frozen at generation. Never re-rendered. */
		bodyHtml: text("body_html").notNull(),
		/** JSON of the values used, so the document can be explained later. */
		variablesJson: text("variables_json"),
		/** Dates with no time are YYYY-MM-DD, not an instant. */
		issuedOn: text("issued_on"),
		pdfPath: text("pdf_path"),
		/**
		 * True when the template had no `reviewedAt` at generation time. Carried on
		 * the document rather than looked up, because reviewing the template later
		 * must not silently reclassify a document that already went out.
		 */
		isSpecimen: integer("is_specimen", { mode: "boolean" }).notNull().default(true),
		/**
		 * `generated` came from a template, `imported` was a PDF that already
		 * existed. An imported document has no body to render and no template
		 * version, so anything that re-renders has to check this first.
		 */
		sourceKind: text("source_kind").notNull().default("generated"),
	},
	(t) => [
		index("documents_client_idx").on(t.clientId),
		index("documents_project_idx").on(t.projectId),
		index("documents_template_idx").on(t.templateId),
		index("documents_status_idx").on(t.statusId),
		index("documents_owner_idx").on(t.ownerId),
		index("documents_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A signature is a PNG, a timestamp and a hash of the bytes that were signed.
 *
 * Decision 8 is binding on what this is worth: it is appropriate for low-stakes
 * and internal documents, and it is NOT a qualified electronic signature under
 * eIDAS. The interface says so, and nothing here should imply otherwise.
 */
export const documentSignatures = sqliteTable(
	"document_signatures",
	{
		...standardColumns,
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id),
		signerName: text("signer_name").notNull(),
		signerRole: text("signer_role"),
		signedAt: text("signed_at").notNull(),
		signatureImagePath: text("signature_image_path"),
		/** SHA-256 of the unsigned PDF, so later tampering is detectable. */
		documentHash: text("document_hash").notNull(),
		signedPdfPath: text("signed_pdf_path"),
		/** JSON: what was signed, by whom, from which template version. */
		auditJson: text("audit_json"),
	},
	(t) => [
		index("document_signatures_document_idx").on(t.documentId),
		index("document_signatures_owner_idx").on(t.ownerId),
	],
);

/**
 * One file a document has been. A document is the thing people talk about, "the
 * hosting agreement with Acme"; its versions are every PDF it has been on the
 * way: generated, imported, stamped, signed digitally, sent back by the client.
 * Nothing is replaced. Opening a document opens its newest version.
 *
 * Newest is by `file_date`, not by when the row was written. An imported file
 * carries the date the file itself was last changed, so an older copy that
 * arrives late lands between the versions it came between, rather than
 * pretending to be the latest.
 */
export const documentVersions = sqliteTable(
	"document_versions",
	{
		...standardColumns,
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id),
		/** generated, imported, stamped or signed. What the version is, not where it came from. */
		kind: text("kind").notNull(),
		/** How it arrived: generate, picker, drop, mail, sign, agent. */
		source: text("source").notNull(),
		pdfPath: text("pdf_path").notNull(),
		/** The name the file had when it arrived, for an imported version. */
		fileName: text("file_name"),
		/** UTC ISO-8601. Orders the versions. */
		fileDate: text("file_date").notNull(),
		/** SHA-256 of the file. Null for versions recorded before this table existed. */
		fileHash: text("file_hash"),
		/** The words in the PDF, for spotting that an incoming file is this document again. */
		textContent: text("text_content"),
		signatureId: text("signature_id").references(() => documentSignatures.id),
		mailAttachmentId: text("mail_attachment_id"),
	},
	(t) => [
		index("document_versions_document_idx").on(t.documentId, t.fileDate),
		index("document_versions_signature_idx").on(t.signatureId),
		index("document_versions_hash_idx").on(t.fileHash),
		index("document_versions_owner_idx").on(t.ownerId),
		index("document_versions_deleted_idx").on(t.deletedAt),
	],
);
