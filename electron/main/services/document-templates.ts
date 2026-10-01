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
import { emptyCanvas } from "../../shared/paper";
import type { DocumentCanvas, DocumentLayout, TemplateInput as TemplateField } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documentTemplates } from "../db/schema";
import { assertOwnPlaceholders, canvasContext, compileCanvas, missingImage, normaliseDocumentCanvas, parseCanvas, serialiseCanvas } from "./document-canvas";
import { compileLayout, parseLayout, serialiseLayout } from "./document-layout";
import { DOCUMENT_TEMPLATE_SEED_VERSION, exampleTemplate } from "./document-templates-seed";
import * as assets from "./document-template-assets";
import * as settings from "./settings";
import { parseInputs, serialiseInputs, validateInputs } from "./template-inputs";
import { placeholdersIn, render, type RenderResult, type TemplateContext } from "./template-render";

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
	/**
	 * The canvas, for a template laid out on paper of a fixed size. When set,
	 * the body is compiled from it and `layout` is not used.
	 */
	canvas: DocumentCanvas | null;
	/** What this template asks for when it is used. */
	inputs: TemplateField[];
}

export interface TemplateInput {
	key?: string;
	name: string;
	description?: string | null;
	/** Left out, a fresh template gets one empty page, which the editor treats as blank. */
	bodyHtml?: string;
	language?: string;
	/** Supplying a layout compiles the body from it and ignores `bodyHtml`. */
	layout?: DocumentLayout | null;
	/** Supplying a canvas compiles the body from it and ignores `layout` and `bodyHtml`. */
	canvas?: DocumentCanvas | null;
	inputs?: TemplateField[];
}

export type TemplatePatch = Partial<
	Pick<TemplateInput, "name" | "description" | "bodyHtml" | "language" | "layout" | "canvas" | "inputs">
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
		canvas: parseCanvas(row.canvasJson),
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

/**
 * A canvas arrives from the window or from an agent, so it is read the way a
 * stored one is: anything that is not a canvas is refused with a message
 * rather than stored as something nobody can open.
 */
function readCanvas(raw: DocumentCanvas | null | undefined): DocumentCanvas | null | undefined {
	if (raw === undefined || raw === null) return raw;
	const canvas = normaliseDocumentCanvas(raw);
	if (!canvas) {
		throw new Error("That canvas could not be read. Send { version: 1, paper, layout } with a layout of pages.");
	}
	return canvas;
}

/** The body a canvas compiles to, after checking it only fills in what it asks for. */
function canvasBody(canvas: DocumentCanvas, inputs: TemplateField[]): string {
	const body = compileCanvas(canvas, inputs);
	assertOwnPlaceholders(body, inputs);
	return body;
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

/**
 * Two templates may share a name: a second variant of the same contract is
 * ordinary. The key is derived from the name, so a repeat counts up (`nda_2`)
 * rather than refusing to create the second one.
 */
async function uniqueKey(base: string, db: Db): Promise<string> {
	const slug = base.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
	if (!(await getByKey(slug, db))) return slug;
	let n = 2;
	while (await getByKey(`${slug}_${n}`, db)) n++;
	return `${slug}_${n}`;
}

export async function create(input: TemplateInput, db: Db = getDb()): Promise<DocumentTemplate> {
	const name = input.name.trim();
	if (!name) throw new Error("A template needs a name.");
	// A caller with nothing to say yet, the plus button beside the heading or an
	// agent's templates.create with a name only, gets the same blank page the
	// editor already treats as an empty template rather than a body it has to
	// invent.
	if (input.inputs) validateInputs(input.inputs);
	const inputs = input.inputs ?? [];
	const given = readCanvas(input.canvas);
	const layout = given ? null : input.layout;
	// A blank template is a canvas: one page of A4, the paper a new document
	// is most often printed on.
	const canvas = given ?? (layout || input.bodyHtml?.trim() ? null : emptyCanvas());
	const body = canvas ? canvasBody(canvas, inputs) : (bodyFor(layout, input.bodyHtml) ?? "");

	const key = await uniqueKey(input.key ?? name, db);

	const [row] = db
		.insert(documentTemplates)
		.values({
			key,
			name,
			description: input.description ?? null,
			language: input.language ?? "nl-BE",
			bodyHtml: body,
			layoutJson: layout ? serialiseLayout(layout) : null,
			canvasJson: serialiseCanvas(canvas),
			inputsJson: serialiseInputs(inputs),
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

	// A canvas, once a template has one, is the template: the body is compiled
	// from it on every write, including a write that only changes the inputs,
	// because a picture input is drawn differently from a text one. A null
	// canvas lets go of it and keeps the body it last compiled to.
	const patchCanvas = readCanvas(patch.canvas);
	const canvas = patchCanvas === undefined ? existing.canvas : patchCanvas;
	const inputs = patch.inputs ?? existing.inputs;
	const canvasChanged = patchCanvas !== undefined || (canvas !== null && patch.inputs !== undefined);

	// A layout edit is a body edit, because the body is compiled from it. Working
	// that out from the compiled HTML is what keeps the review flag honest when
	// the person edited the page rather than the markup.
	const nextBody =
		canvas && canvasChanged
			? canvasBody(canvas, inputs)
			: canvas
				? undefined
				: bodyFor(patch.layout, patch.bodyHtml);
	const bodyChanged = nextBody !== undefined && nextBody !== existing.bodyHtml;

	const [row] = db
		.update(documentTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description } : {}),
			...(patch.language !== undefined ? { language: patch.language } : {}),
			...(nextBody !== undefined ? { bodyHtml: nextBody } : {}),
			...(patch.layout !== undefined && !canvas
				? { layoutJson: patch.layout ? serialiseLayout(patch.layout) : null }
				: {}),
			...(patchCanvas !== undefined ? { canvasJson: serialiseCanvas(patchCanvas) } : {}),
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
 * Fills a canvas template with the values typed for it, and nothing else.
 *
 * The canvas is compiled again here rather than the stored body used, so the
 * editor can render a draft and a generated document can carry its fonts
 * inline (`fontCss`). The pictures the template carries go in as `data:`
 * addresses, so the result stands on its own. `missing` is every input with no
 * value and every picture whose file is gone, as `document.<key>` and
 * `asset.<key>`, and each is a marked gap in what is rendered.
 */
export function renderCanvas(
	input: {
		templateId: string;
		canvas: DocumentCanvas;
		inputs: TemplateField[];
		values: Record<string, string>;
		fontCss?: string;
	},
	db: Db = getDb(),
): RenderResult {
	const body = compileCanvas(input.canvas, input.inputs, input.fontCss ?? "");
	const pictures = assets.dataUrls(input.templateId, db);
	const gone = placeholdersIn(body)
		.filter((path) => path.startsWith("asset.") && !pictures[path.slice("asset.".length)])
		.map((path) => path.slice("asset.".length));
	for (const key of gone) pictures[key] = missingImage(`asset.${key}`);
	const { context, missing } = canvasContext(input.inputs, input.values, pictures);
	const rendered = render(body, context);
	const all = new Set([
		...rendered.missing,
		...missing.map((key) => `document.${key}`),
		...gone.map((key) => `asset.${key}`),
	]);
	return { ...rendered, missing: [...all].sort() };
}

/**
 * A canvas template filled in with values, without storing anything, for an
 * agent or the editor to check what a document will say. A draft canvas and
 * inputs may be given in place of the stored ones.
 */
export async function fillCanvas(
	input: { templateId: string; values: Record<string, string>; canvas?: DocumentCanvas; inputs?: TemplateField[] },
	db: Db = getDb(),
): Promise<RenderResult> {
	const template = await get(input.templateId, db);
	if (!template) throw new Error("That template no longer exists.");
	const canvas = readCanvas(input.canvas) ?? template.canvas;
	if (!canvas) throw new Error("This template is not laid out on paper. Fill it in with documents.generate instead.");
	const inputs = input.inputs ?? template.inputs;
	if (input.inputs) validateInputs(input.inputs);
	return renderCanvas({ templateId: template.id, canvas, inputs, values: input.values }, db);
}

/**
 * Puts the example on a first install, and does nothing else, ever.
 *
 * Five templates used to be seeded here by key. They are not any more: an
 * install that has them keeps them exactly as they are, because this function
 * neither adds, updates, hides nor removes a row that exists. What it does is
 * decide whether this is a first install, which takes two answers to agree:
 * the settings say the set was never seeded, and the table has no row in it at
 * all, deleted and hidden ones included. An upgrade fails the second, and an
 * owner who deleted the example fails both once the version is written, so it
 * is never brought back.
 *
 * The example is written by `create`, like anything a person makes: it is not
 * a system row, so a reset does not touch it, deleting it is a real delete, and
 * it starts unreviewed. The source is a parameter so a test can apply a later
 * version.
 */
export async function ensureTemplatesSeeded(
	db: Db = getDb(),
	source: { version: number; example: () => TemplateInput } = {
		version: DOCUMENT_TEMPLATE_SEED_VERSION,
		example: exampleTemplate,
	},
): Promise<{ created: number; updated: number }> {
	const applied = await settings.getDocumentTemplateSeedVersion();
	if (applied >= source.version) return { created: 0, updated: 0 };

	let created = 0;
	const empty = db.select({ id: documentTemplates.id }).from(documentTemplates).limit(1).get() === undefined;
	if (applied === 0 && empty) {
		await create(source.example(), db);
		created = 1;
	}

	await settings.setDocumentTemplateSeedVersion(source.version);
	return { created, updated: 0 };
}
