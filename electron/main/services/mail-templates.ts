/**
 * Mail templates: a Dutch subject and body with placeholders, filled from the
 * same context the document templates use, so a client's name is spelled the
 * same way in the mail as in the contract it carries.
 *
 * Seeded reference data, decision 16: shipped rows are updated by an upgrade
 * only while unedited, and a removed one is soft-deleted rather than purged.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { primaryOwnerEmail, primaryOwnerPhone } from "../../shared/owner";
import type {
	MailBlockConversion,
	MailLayout,
	MailRegister,
	MailTemplate,
	MailTemplateDraft,
	MailTemplateInput,
	MailTemplatePatch,
	MailTemplateRender,
	TemplateInput,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { mailTemplates } from "../db/schema";
import { previewContext } from "./documents";
import { formatDate } from "./document-context";
import { canvasShell, htmlToText, mailShell } from "./mail-html";
import {
	breakpointCss,
	compileLayout,
	convertBlockToCode,
	fontLinks,
	layoutFromHtml,
	normaliseLayout,
	parseLayout,
	serialiseLayout,
} from "./mail-layout";
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
		hiddenAt: row.hiddenAt,
		placeholders: [...new Set([...placeholdersIn(row.subject), ...placeholdersIn(row.bodyHtml)])].sort(),
		inputs: parseInputs(row.inputsJson),
		layout: parseLayout(row.layoutJson),
	};
}

/**
 * What gets written to `body_html` and `layout_json` for one edit.
 *
 * A layout always wins over a body: the canvas is the source and the HTML is
 * output, so a caller that sends both has sent one thing twice. Passing
 * `layout: null` deliberately drops the canvas and keeps the body that was
 * compiled from it, which is how a template is converted back to hand-written
 * HTML without losing what it looked like.
 */
function bodyFrom(
	layout: MailLayout | null | undefined,
	bodyHtml: string | undefined,
	inputs: TemplateInput[],
): { bodyHtml?: string; layoutJson?: string | null } {
	if (layout === undefined) {
		return bodyHtml === undefined ? {} : { bodyHtml };
	}
	if (layout === null) {
		return { ...(bodyHtml === undefined ? {} : { bodyHtml }), layoutJson: null };
	}
	const normalised = normaliseLayout(layout);
	if (!normalised) throw new Error("That layout could not be read. Nothing was saved.");
	return { bodyHtml: compileLayout(normalised, inputs), layoutJson: serialiseLayout(normalised) };
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

/**
 * Every template, hidden ones included.
 *
 * `list` is what a picker asks for; this is what the management screen asks
 * for, because a hidden template has to be reachable to be put back. Picking
 * the wrong one of these two is the bug section 9 of the data rules exists to
 * prevent.
 */
export async function listAll(db: Db = getDb()): Promise<MailTemplate[]> {
	return db
		.select()
		.from(mailTemplates)
		.where(isNull(mailTemplates.deletedAt))
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
			...bodyFrom(input.layout, input.bodyHtml, input.inputs ?? []),
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
	const current = await get(id, db);
	if (!current) throw new Error("That template does not exist.");

	const inputs = patch.inputs ?? current.inputs;
	// A field block renders as a picture or as text depending on the kind of the
	// input it names, so changing the inputs alone still changes the compiled
	// body. Recompiling from the stored canvas here is what keeps the two from
	// drifting apart on an edit that never touched the layout.
	const layout = patch.layout !== undefined ? patch.layout : current.layout ? current.layout : undefined;
	const body = bodyFrom(layout, patch.bodyHtml, inputs);

	const updated = db
		.update(mailTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
			...(patch.register !== undefined ? { register: patch.register } : {}),
			...(patch.subject !== undefined ? { subject: patch.subject.trim() } : {}),
			...body,
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

/**
 * Removing a template.
 *
 * A shipped template is hidden, never deleted, because drafts already point at
 * it and a row that vanishes takes their history with it. One the owner wrote
 * is soft-deleted like any other record. Both are recoverable, and neither
 * touches the file (.claude/rules/data.md section 9).
 */
export async function remove(id: string, db: Db = getDb()): Promise<MailTemplate> {
	const current = await get(id, db);
	if (!current) throw new Error("That template does not exist.");
	if (current.isSystem) return hide(id, db);

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

/** Takes a template out of the pickers. Anything already pointing at it still
 * resolves and still renders. */
export async function hide(id: string, db: Db = getDb()): Promise<MailTemplate> {
	const stamp = now();
	const updated = db
		.update(mailTemplates)
		.set({ hiddenAt: stamp, updatedAt: stamp })
		.where(and(eq(mailTemplates.id, id), isNull(mailTemplates.deletedAt)))
		.returning()
		.get();
	if (!updated) throw new Error("That template does not exist.");
	return toRecord(updated);
}

/** Puts a hidden template back in the pickers. */
export async function unhide(id: string, db: Db = getDb()): Promise<MailTemplate> {
	const stamp = now();
	const updated = db
		.update(mailTemplates)
		.set({ hiddenAt: null, updatedAt: stamp })
		.where(and(eq(mailTemplates.id, id), isNull(mailTemplates.deletedAt)))
		.returning()
		.get();
	if (!updated) throw new Error("That template does not exist.");
	return toRecord(updated);
}

/**
 * A copy, as a template of the owner's own.
 *
 * This is how a shipped template gets edited without the edit counting as a
 * change to what shipped: the copy is not a system row, so a reset leaves it
 * alone and an upgrade never reaches it.
 */
export async function duplicate(id: string, db: Db = getDb()): Promise<MailTemplate> {
	const source = await get(id, db);
	if (!source) throw new Error("That template does not exist.");
	return create(
		{
			name: `${source.name} copy`,
			description: source.description,
			register: source.register,
			subject: source.subject,
			bodyHtml: source.bodyHtml,
			inputs: source.inputs,
			layout: source.layout,
		},
		db,
	);
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
		[primaryOwnerEmail(owner)?.email, primaryOwnerPhone(owner)?.phone].filter(Boolean).join(" | "),
	];
}

/**
 * The document a rendered body is sent in. A canvas is the whole message and
 * goes out as it was laid out, with its fonts and its breakpoints in the head.
 * A hand-written template goes in the house shell, which gives it the card and
 * the footer it was written to sit in.
 */
async function shellFor(bodyHtml: string, layout: MailLayout | null, inputs: TemplateInput[]): Promise<string> {
	if (layout) return canvasShell(bodyHtml, { fontLinks: fontLinks(layout), css: breakpointCss(layout, inputs) });
	return mailShell(bodyHtml, { footerLines: await footerLines() });
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
	const bodyHtml = await shellFor(body.html, template.layout, template.inputs);
	return {
		// The subject is text, so the escaping the renderer applied comes off again,
		// and a missing-value marker keeps its words and loses its markup.
		subject: unescapeHtml(subject.html.replace(/<[^>]+>/g, "")).trim(),
		bodyHtml,
		bodyText: htmlToText(body.html),
		missing: [...new Set([...subject.missing, ...body.missing])].sort(),
	};
}

/**
 * Renders values that are in hand rather than a row that is saved.
 *
 * The editor needs this and the old one did not have it, which is why it saved
 * on a timer to keep its preview honest and stamped `customisedAt` on
 * templates nobody had deliberately edited. A preview is a read, so it writes
 * nothing: a template the owner is still looking at stays untouched until they
 * press save.
 */
/**
 * Reads hand-edited HTML back into a canvas.
 *
 * This is what makes the code view something that can be typed in rather than
 * only read. It is a pure read: nothing is stored, so an author can paste
 * markup, see what it becomes on the canvas, and still walk away.
 *
 * Markup it recognises comes back as the block it was; markup it does not
 * comes back as a raw block where it was written. It never refuses and it
 * never drops, but it does not promise byte-identical output for a
 * hand-written document, which is the limit the editor has to state.
 */
export async function parseBody(html: string): Promise<MailLayout> {
	return layoutFromHtml(html);
}

/**
 * One block of a canvas in hand turned into the HTML and CSS it compiles to,
 * which is what "Convert to HTML" does in the editor.
 *
 * A pure read like `parseBody`: it answers with the changed canvas and stores
 * nothing, so the conversion is part of the draft and is saved, or not, with
 * everything else. An agent has no need of it, because an agent writes a code
 * block into the layout it proposes directly.
 */
export async function convertBlock(input: MailBlockConversion): Promise<MailLayout> {
	const layout = normaliseLayout(input.layout);
	if (!layout) throw new Error("That layout could not be read. Nothing was converted.");
	const section = layout.sections.find((entry) => entry.id === input.sectionId);
	if (!section?.blocks.some((block) => block.id === input.blockId)) {
		throw new Error("That block is not on the canvas any more. Select it again and convert it.");
	}
	return convertBlockToCode(layout, input.sectionId, input.blockId, input.inputs ?? []);
}

export async function previewDraft(draft: MailTemplateDraft, db: Db = getDb()): Promise<MailTemplateRender> {
	const inputs = draft.inputs ?? [];
	const layout = draft.layout ? normaliseLayout(draft.layout) : null;
	if (draft.layout && !layout) throw new Error("That layout could not be read.");
	const body = layout ? compileLayout(layout, inputs) : (draft.bodyHtml ?? "");

	const context = await previewContext({ clientId: draft.clientId, projectId: draft.projectId }, db);
	const document = (context.document as Record<string, unknown> | undefined) ?? {};
	const extras = draft.extras ?? {};
	context.document = {
		...document,
		...extras,
		...(extras.dueOn ? { dueOn: formatDate(extras.dueOn) } : {}),
	};

	const subject = render(draft.subject, context);
	const rendered = render(body, context);
	return {
		subject: unescapeHtml(subject.html.replace(/<[^>]+>/g, "")).trim(),
		bodyHtml: await shellFor(rendered.html, layout, inputs),
		bodyText: htmlToText(rendered.html),
		missing: [...new Set([...subject.missing, ...rendered.missing])].sort(),
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
