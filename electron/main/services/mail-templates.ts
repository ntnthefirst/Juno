/**
 * Mail templates: a Dutch subject and body with placeholders, filled from the
 * same context the document templates use, so a client's name is spelled the
 * same way in the mail as in the contract it carries.
 *
 * Seeded reference data, decision 16: shipped rows are updated by an upgrade
 * only while unedited, and a removed one is soft-deleted rather than purged.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type {
	MailRegister,
	MailTemplate,
	MailTemplateInput,
	MailTemplatePatch,
	MailTemplateRender,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { mailTemplates } from "../db/schema";
import { previewContext } from "./documents";
import { formatDate } from "./document-context";
import { htmlToText, mailShell } from "./mail-html";
import { MAIL_TEMPLATES, MAIL_TEMPLATE_SEED_VERSION } from "./mail-templates-seed";
import * as settings from "./settings";
import { placeholdersIn, render, unescapeHtml } from "./template-render";
import { parseInputs, serialiseInputs, validateInputs } from "./template-inputs";

export interface SeedMailTemplate {
	key: string;
	name: string;
	description: string;
	register: MailRegister;
	subject: string;
	bodyHtml: string;
}

type Row = typeof mailTemplates.$inferSelect;

const REGISTERS: MailRegister[] = ["u", "je"];

function toRecord(row: Row): MailTemplate {
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		key: row.key,
		name: row.name,
		description: row.description,
		language: row.language,
		register: row.register as MailRegister,
		subject: row.subject,
		bodyHtml: row.bodyHtml,
		isSystem: row.isSystem,
		customisedAt: row.customisedAt,
		placeholders: [...new Set([...placeholdersIn(row.subject), ...placeholdersIn(row.bodyHtml)])].sort(),
		inputs: parseInputs(row.inputsJson),
	};
}

function validate(input: MailTemplateInput | MailTemplatePatch): void {
	if (input.name !== undefined && !input.name.trim()) throw new Error("A template needs a name.");
	if (input.subject !== undefined && !input.subject.trim()) throw new Error("A template needs a subject.");
	if (input.bodyHtml !== undefined && !input.bodyHtml.trim()) throw new Error("A template needs a body.");
	if (input.register !== undefined && !REGISTERS.includes(input.register)) {
		throw new Error("The register has to be u or je.");
	}
	if (input.inputs !== undefined) validateInputs(input.inputs);
}

export async function list(db: Db = getDb()): Promise<MailTemplate[]> {
	return db
		.select()
		.from(mailTemplates)
		.where(and(isNull(mailTemplates.deletedAt), isNull(mailTemplates.hiddenAt)))
		.orderBy(asc(mailTemplates.sortOrder), asc(mailTemplates.name))
		.all()
		.map(toRecord);
}

export async function get(id: string, db: Db = getDb()): Promise<MailTemplate | null> {
	const row = db
		.select()
		.from(mailTemplates)
		.where(and(eq(mailTemplates.id, id), isNull(mailTemplates.deletedAt)))
		.get();
	return row ? toRecord(row) : null;
}

export async function getByKey(key: string, db: Db = getDb()): Promise<MailTemplate | null> {
	const row = db
		.select()
		.from(mailTemplates)
		.where(and(eq(mailTemplates.key, key), isNull(mailTemplates.deletedAt)))
		.get();
	return row ? toRecord(row) : null;
}

export async function create(input: MailTemplateInput, db: Db = getDb()): Promise<MailTemplate> {
	validate(input);
	const stamp = now();
	const key = input.key?.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
	const inserted = db
		.insert(mailTemplates)
		.values({
			key,
			name: input.name.trim(),
			description: input.description?.trim() || null,
			register: input.register ?? "u",
			subject: input.subject.trim(),
			bodyHtml: input.bodyHtml,
			inputsJson: serialiseInputs(input.inputs ?? []),
			isSystem: false,
			sortOrder: 100,
			createdAt: stamp,
			updatedAt: stamp,
		})
		.returning()
		.get();
	return toRecord(inserted);
}

export async function update(id: string, patch: MailTemplatePatch, db: Db = getDb()): Promise<MailTemplate> {
	validate(patch);
	const stamp = now();
	const updated = db
		.update(mailTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
			...(patch.register !== undefined ? { register: patch.register } : {}),
			...(patch.subject !== undefined ? { subject: patch.subject.trim() } : {}),
			...(patch.bodyHtml !== undefined ? { bodyHtml: patch.bodyHtml } : {}),
			...(patch.inputs !== undefined ? { inputsJson: serialiseInputs(patch.inputs) } : {}),
			// Set once, so an upgrade never overwrites what the owner wrote.
			customisedAt: stamp,
			updatedAt: stamp,
		})
		.where(and(eq(mailTemplates.id, id), isNull(mailTemplates.deletedAt)))
		.returning()
		.get();
	if (!updated) throw new Error("That template does not exist.");
	return toRecord(updated);
}

export async function remove(id: string, db: Db = getDb()): Promise<MailTemplate> {
	const stamp = now();
	const updated = db
		.update(mailTemplates)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(mailTemplates.id, id), isNull(mailTemplates.deletedAt)))
		.returning()
		.get();
	if (!updated) throw new Error("That template does not exist.");
	return toRecord(updated);
}

export interface RenderInput {
	templateId: string;
	clientId?: string | null;
	projectId?: string | null;
	/** Values a template asks for that no record holds: document.title, document.dueOn, document.amount. */
	extras?: Record<string, string>;
}

/** The footer every outgoing message carries: who sent it, in one or two lines. */
export async function footerLines(): Promise<string[]> {
	const owner = await settings.getOwner();
	const address = [owner.addressLine1, [owner.postalCode, owner.city].filter(Boolean).join(" ")]
		.filter((part) => part && part.trim())
		.join(", ");
	return [
		owner.businessName,
		address,
		owner.vatNumber ? `Ondernemingsnummer ${owner.vatNumber}` : "",
		[owner.email, owner.phone].filter(Boolean).join(" | "),
	];
}

/**
 * Fills a template against a client and project. The subject is rendered as
 * text, the body as HTML in the house shell, and the text twin is derived from
 * the body so the two never disagree.
 */
export async function renderTemplate(input: RenderInput, db: Db = getDb()): Promise<MailTemplateRender> {
	const template = await get(input.templateId, db);
	if (!template) throw new Error("That template does not exist.");

	const context = await previewContext({ clientId: input.clientId, projectId: input.projectId }, db);
	const document = (context.document as Record<string, unknown> | undefined) ?? {};
	const extras = input.extras ?? {};
	context.document = {
		...document,
		...extras,
		// A date typed as YYYY-MM-DD reads as 14/11/2026 in the message.
		...(extras.dueOn ? { dueOn: formatDate(extras.dueOn) } : {}),
	};

	const subject = render(template.subject, context);
	const body = render(template.bodyHtml, context);
	const bodyHtml = mailShell(body.html, { footerLines: await footerLines() });
	return {
		// The subject is text, so the escaping the renderer applied comes off again,
		// and a missing-value marker keeps its words and loses its markup.
		subject: unescapeHtml(subject.html.replace(/<[^>]+>/g, "")).trim(),
		bodyHtml,
		bodyText: htmlToText(body.html),
		missing: [...new Set([...subject.missing, ...body.missing])].sort(),
	};
}

export async function ensureMailTemplatesSeeded(
	db: Db = getDb(),
	source: { version: number; templates: SeedMailTemplate[] } = {
		version: MAIL_TEMPLATE_SEED_VERSION,
		templates: MAIL_TEMPLATES,
	},
): Promise<{ created: number; updated: number }> {
	let created = 0;
	let updated = 0;

	source.templates.forEach((seed, index) => {
		const existing = db.select().from(mailTemplates).where(eq(mailTemplates.seedKey, seed.key)).get();
		if (!existing) {
			db.insert(mailTemplates)
				.values({
					seedKey: seed.key,
					key: seed.key,
					name: seed.name,
					description: seed.description,
					register: seed.register,
					subject: seed.subject,
					bodyHtml: seed.bodyHtml,
					isSystem: true,
					sortOrder: index,
				})
				.run();
			created++;
			return;
		}
		// An edited, hidden or removed row is the owner's. Leave it alone.
		if (existing.customisedAt !== null || existing.hiddenAt !== null || existing.deletedAt !== null) return;
		if (existing.bodyHtml === seed.bodyHtml && existing.subject === seed.subject && existing.name === seed.name) return;
		db.update(mailTemplates)
			.set({
				name: seed.name,
				description: seed.description,
				register: seed.register,
				subject: seed.subject,
				bodyHtml: seed.bodyHtml,
				sortOrder: index,
				updatedAt: now(),
			})
			.where(eq(mailTemplates.id, existing.id))
			.run();
		updated++;
	});

	return { created, updated };
}
