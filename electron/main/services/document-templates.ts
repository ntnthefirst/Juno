/**
 * Document templates: the legal text with placeholders in it.
 *
 * Every rule about a template lives here. See .claude/rules/architecture.md.
 *
 * The one rule worth stating twice: a template with no `reviewedAt` is a
 * specimen. Nothing generated from it may be presented as a real contract, and
 * clearing that flag is a deliberate act, never a side effect of an edit.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DocumentLayout, TemplateInput as TemplateField } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documentTemplates } from "../db/schema";
import { DOCUMENT_TEMPLATES, DOCUMENT_TEMPLATE_SEED_VERSION } from "./document-templates-seed";
import { compileLayout, parseLayout, serialiseLayout } from "./document-layout";
import { parseInputs, serialiseInputs, validateInputs } from "./template-inputs";
import { placeholdersIn, render, type RenderResult, type TemplateContext } from "./template-render";

export interface SeedTemplate {
	key: string;
	name: string;
	description: string;
	bodyHtml: string;
}

export interface DocumentTemplate {
	id: string;
	ownerId: string;
	deletedAt: string | null;
	key: string;
	name: string;
	description: string | null;
	language: string;
	bodyHtml: string;
	reviewedAt: string | null;
	version: number;
	isSystem: boolean;
	customisedAt: string | null;
	createdAt: string;
	updatedAt: string;
	/** Convenience for the interface: every path the body refers to. */
	placeholders: string[];
	/**
	 * The page model the editor works on, or null for a template that is edited
	 * as HTML. `bodyHtml` is compiled from this whenever it is present, so
	 * nothing below this layer has to know which of the two it is looking at.
	 */
	layout: DocumentLayout | null;
	/** What this template asks for when it is used. */
	inputs: TemplateField[];
}

export interface TemplateInput {
	key?: string;
	name: string;
	description?: string | null;
	bodyHtml: string;
	language?: string;
	/** Supplying a layout compiles the body from it and ignores `bodyHtml`. */
	layout?: DocumentLayout | null;
	inputs?: TemplateField[];
}

export type TemplatePatch = Partial<
	Pick<TemplateInput, "name" | "description" | "bodyHtml" | "language" | "layout" | "inputs">
>;

type Row = typeof documentTemplates.$inferSelect;

function toTemplate(row: Row): DocumentTemplate {
	return {
		id: row.id,
		ownerId: row.ownerId,
		deletedAt: row.deletedAt,
		key: row.key,
		name: row.name,
		description: row.description,
		language: row.language,
		bodyHtml: row.bodyHtml,
		reviewedAt: row.reviewedAt,
		version: row.version,
		isSystem: row.isSystem,
		customisedAt: row.customisedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		placeholders: placeholdersIn(row.bodyHtml),
		layout: parseLayout(row.layoutJson),
		inputs: parseInputs(row.inputsJson),
	};
}

/**
 * A layout is the source and the HTML is the output, so the two can never
 * disagree: whenever a layout is written the body is compiled from it in the
 * same statement. A template with no layout keeps the HTML it was given.
 */
function bodyFor(layout: DocumentLayout | null | undefined, bodyHtml: string | undefined): string | undefined {
	if (layout) return compileLayout(layout);
	return bodyHtml;
}

export async function list(db: Db = getDb()): Promise<DocumentTemplate[]> {
	return db
		.select()
		.from(documentTemplates)
		.where(isNull(documentTemplates.deletedAt))
		.orderBy(asc(documentTemplates.sortOrder), asc(documentTemplates.name))
		.all()
		.map(toTemplate);
}

export async function get(id: string, db: Db = getDb()): Promise<DocumentTemplate | null> {
	const row = db
		.select()
		.from(documentTemplates)
		.where(and(eq(documentTemplates.id, id), isNull(documentTemplates.deletedAt)))
		.get();
	return row ? toTemplate(row) : null;
}

export async function getByKey(key: string, db: Db = getDb()): Promise<DocumentTemplate | null> {
	const row = db
		.select()
		.from(documentTemplates)
		.where(and(eq(documentTemplates.key, key), isNull(documentTemplates.deletedAt)))
		.get();
	return row ? toTemplate(row) : null;
}

export async function create(input: TemplateInput, db: Db = getDb()): Promise<DocumentTemplate> {
	const name = input.name.trim();
	if (!name) throw new Error("A template needs a name.");
	const body = bodyFor(input.layout, input.bodyHtml) ?? "";
	if (!input.layout && !body.trim()) throw new Error("A template needs a body.");
	if (input.inputs) validateInputs(input.inputs);

	const key = (input.key ?? name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
	if (await getByKey(key, db)) throw new Error(`A template with the key "${key}" already exists.`);

	const [row] = db
		.insert(documentTemplates)
		.values({
			key,
			name,
			description: input.description ?? null,
			language: input.language ?? "nl-BE",
			bodyHtml: body,
			layoutJson: input.layout ? serialiseLayout(input.layout) : null,
			inputsJson: serialiseInputs(input.inputs ?? []),
			isSystem: false,
			// A template someone wrote themselves is still unreviewed until they say
			// otherwise. Assuming it is reviewed because it is theirs is the exact
			// mistake the flag exists to prevent.
			reviewedAt: null,
		})
		.returning()
		.all();
	return toTemplate(row!);
}

export async function update(
	id: string,
	patch: TemplatePatch,
	db: Db = getDb(),
): Promise<DocumentTemplate> {
	const existing = await get(id, db);
	if (!existing) throw new Error("That template no longer exists.");

	if (patch.inputs) validateInputs(patch.inputs);

	// A layout edit is a body edit, because the body is compiled from it. Working
	// that out from the compiled HTML is what keeps the review flag honest when
	// the person edited the page rather than the markup.
	const nextBody = bodyFor(patch.layout, patch.bodyHtml);
	const bodyChanged = nextBody !== undefined && nextBody !== existing.bodyHtml;

	const [row] = db
		.update(documentTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description } : {}),
			...(patch.language !== undefined ? { language: patch.language } : {}),
			...(nextBody !== undefined ? { bodyHtml: nextBody } : {}),
			...(patch.layout !== undefined
				? { layoutJson: patch.layout ? serialiseLayout(patch.layout) : null }
				: {}),
			...(patch.inputs !== undefined ? { inputsJson: serialiseInputs(patch.inputs) } : {}),
			// Editing the text invalidates any review of it. Keeping the flag would
			// let a reviewed template quietly become an unreviewed one.
			...(bodyChanged ? { reviewedAt: null, version: existing.version + 1 } : {}),
			customisedAt: now(),
			updatedAt: now(),
		})
		.where(eq(documentTemplates.id, id))
		.returning()
		.all();
	return toTemplate(row!);
}

/**
 * Marks the text as checked. Separate from `update` on purpose: reviewing is a
 * claim about the content, and it should never be possible to make that claim by
 * accident while editing.
 */
export async function setReviewed(
	id: string,
	reviewed: boolean,
	db: Db = getDb(),
): Promise<DocumentTemplate> {
	const [row] = db
		.update(documentTemplates)
		.set({ reviewedAt: reviewed ? now() : null, updatedAt: now() })
		.where(eq(documentTemplates.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That template no longer exists.");
	return toTemplate(row);
}

export async function remove(id: string, db: Db = getDb()): Promise<DocumentTemplate> {
	const [row] = db
		.update(documentTemplates)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documentTemplates.id, id))
		.returning()
		.all();
	if (!row) throw new Error("That template no longer exists.");
	return toTemplate(row);
}

export function renderTemplate(template: DocumentTemplate, context: TemplateContext): RenderResult {
	return render(template.bodyHtml, context);
}

/**
 * Seeds the shipped templates. Idempotent, and it never overwrites a body the
 * owner has edited, which is the whole point: the seeded text is a placeholder
 * they are expected to replace.
 */
export async function ensureTemplatesSeeded(
	db: Db = getDb(),
	source: { version: number; templates: SeedTemplate[] } = {
		version: DOCUMENT_TEMPLATE_SEED_VERSION,
		templates: DOCUMENT_TEMPLATES,
	},
): Promise<{ created: number; updated: number }> {
	let created = 0;
	let updated = 0;

	source.templates.forEach((seed, index) => {
		const existing = db
			.select()
			.from(documentTemplates)
			.where(eq(documentTemplates.seedKey, seed.key))
			.get();

		if (!existing) {
			db.insert(documentTemplates)
				.values({
					seedKey: seed.key,
					key: seed.key,
					name: seed.name,
					description: seed.description,
					bodyHtml: seed.bodyHtml,
					isSystem: true,
					sortOrder: index,
					reviewedAt: null,
				})
				.run();
			created++;
			return;
		}

		// An edited or hidden row is the owner's. Leave it alone.
		if (existing.customisedAt !== null || existing.hiddenAt !== null) return;
		if (existing.bodyHtml === seed.bodyHtml && existing.name === seed.name) return;

		db.update(documentTemplates)
			.set({
				name: seed.name,
				description: seed.description,
				bodyHtml: seed.bodyHtml,
				sortOrder: index,
				updatedAt: now(),
			})
			.where(eq(documentTemplates.id, existing.id))
			.run();
		updated++;
	});

	return { created, updated };
}
