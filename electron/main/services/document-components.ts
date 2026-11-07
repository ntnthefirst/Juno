/**
 * Components for document templates on paper: a piece of a page made once and
 * placed in many templates (decision 65).
 *
 * Every rule about one lives here. A template holds a reference to a component
 * and the values it was given, never a copy, so what this module changes is
 * changed in every template that places it, and the rules that follow from
 * that are enforced here and not in an adapter:
 *
 * - **A component cannot contain itself**, directly or through another.
 *   Saving one that does is refused, and expanding one that somehow does
 *   throws rather than recursing.
 * - **Editing one clears the review flag of every template that uses it**,
 *   through `templates.recompile`, because their text is no longer the text
 *   that was read.
 * - **Deleting one is refused while anything uses it**, naming what does. A
 *   template that points at a gone component cannot be printed, which is the
 *   case data.md section 9 describes for a row that is referenced.
 * - **A document already generated is not touched.** Its body is frozen at
 *   generation like everything else in it.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { componentIdsIn, detachPlacement, placesComponent, retargetAssets } from "../../shared/components";
import { DEFAULT_PAPER, newPage, normaliseCanvas } from "../../shared/paper";
import type {
	ComponentUse,
	DetachInput,
	DetachResult,
	DocumentCanvas,
	DocumentComponent,
	DocumentComponentInput,
	DocumentComponentPatch,
	MailContainer,
	MailFont,
	MailLayout,
	TemplateInput,
} from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { documentComponents, documentTemplates } from "../db/schema";
import { assertOwnPlaceholders, compileCanvas } from "./document-canvas";
import { lookupFor, readRoot, toComponent } from "./document-component-lookup";
import * as assets from "./document-template-assets";
import * as templates from "./document-templates";
import { emptyContainer } from "./mail-layout";
import type { RenderResult } from "./template-render";
import { serialiseInputs, validateInputs } from "./template-inputs";

/** The content of a component, as the layout reader will accept it. Anything else is refused with a message. */
function checked(root: unknown, fonts: unknown): { root: MailContainer; fonts: MailFont[] } {
	const read = readRoot(root, fonts);
	if (!read) throw new Error("That component could not be read. Send a container with its content as children.");
	return { root: { ...read.root, component: null }, fonts: read.fonts };
}

/** A component's content has to fill in only what it asks for, and may place only components that exist. */
function assertSound(
	id: string | null,
	root: MailContainer,
	fonts: MailFont[],
	inputs: TemplateInput[],
	db: Db,
): void {
	validateInputs(inputs);
	const lookup = lookupFor(db);
	for (const placed of componentIdsIn(root.children)) {
		if (!lookup(placed)) throw new Error("This component places another component that no longer exists. Take it out first.");
	}
	if (id && placesComponent(root.children, id, lookup)) {
		throw new Error("A component cannot contain itself, not even through another component. Take it out of the content.");
	}
	// Compiled alone, on a sheet, which is what finds a placeholder that is not one of its inputs.
	const sheet = componentCanvas(root, fonts);
	assertOwnPlaceholders(compileCanvas(sheet, inputs), inputs);
}

/** The component alone on one A4 page, for printing it and for checking it. */
export function componentCanvas(root: MailContainer, fonts: MailFont[]): DocumentCanvas {
	const layout: MailLayout = {
		version: 2,
		width: 0,
		widthMode: "fixed",
		minHeight: 0,
		fill: null,
		fonts,
		customCss: null,
		children: [{ ...newPage(DEFAULT_PAPER, "Page 1"), children: [root] }],
		breakpoints: [],
	};
	return normaliseCanvas({ version: 1, paper: DEFAULT_PAPER, layout });
}

/** Every live template that places a component, directly or through another component. */
export async function usedBy(id: string, db: Db = getDb()): Promise<ComponentUse[]> {
	const lookup = lookupFor(db);
	const rows = db
		.select({ id: documentTemplates.id, name: documentTemplates.name })
		.from(documentTemplates)
		.where(isNull(documentTemplates.deletedAt))
		.all();
	const out: ComponentUse[] = [];
	for (const row of rows) {
		const template = await templates.get(row.id, db);
		if (!template?.canvas) continue;
		const placed = componentIdsIn(template.canvas.layout.children);
		if (placed.includes(id) || placed.some((other) => placesComponent(lookup(other)?.root.children ?? [], id, lookup))) {
			out.push({ templateId: row.id, templateName: row.name });
		}
	}
	return out;
}

/** The components that place this one, which are affected by a change to it as much as templates are. */
function placedBy(id: string, db: Db): DocumentComponent[] {
	const lookup = lookupFor(db);
	return db
		.select()
		.from(documentComponents)
		.where(isNull(documentComponents.deletedAt))
		.all()
		.flatMap((row) => {
			const component = toComponent(row);
			return component && component.id !== id && placesComponent(component.root.children, id, lookup) ? [component] : [];
		});
}

export async function list(db: Db = getDb()): Promise<DocumentComponent[]> {
	const rows = db
		.select()
		.from(documentComponents)
		.where(isNull(documentComponents.deletedAt))
		.orderBy(asc(documentComponents.name), asc(documentComponents.id))
		.all();
	const out: DocumentComponent[] = [];
	for (const row of rows) {
		const component = toComponent(row);
		if (component) out.push({ ...component, usedBy: (await usedBy(row.id, db)).length });
	}
	return out;
}

export async function get(id: string, db: Db = getDb()): Promise<DocumentComponent | null> {
	const row = db
		.select()
		.from(documentComponents)
		.where(and(eq(documentComponents.id, id), isNull(documentComponents.deletedAt)))
		.get();
	const component = row ? toComponent(row) : null;
	return component ? { ...component, usedBy: (await usedBy(id, db)).length } : null;
}

export async function create(input: DocumentComponentInput, db: Db = getDb()): Promise<DocumentComponent> {
	const name = input.name.trim();
	if (!name) throw new Error("A component needs a name.");
	const inputs = input.inputs ?? [];
	const { root, fonts } = checked(input.root ?? emptyContainer("div", name), input.fonts ?? []);
	assertSound(null, root, fonts, inputs, db);
	const [row] = db
		.insert(documentComponents)
		.values({
			name,
			description: input.description ?? null,
			rootJson: JSON.stringify(root),
			fontsJson: fonts.length > 0 ? JSON.stringify(fonts) : null,
			inputsJson: serialiseInputs(inputs),
		})
		.returning()
		.all();
	return { ...toComponent(row!)!, usedBy: 0 };
}

/**
 * Changes a component, and with it every template that places it. The
 * templates are compiled again and lose their review, because their text
 * changed under them. Renaming one, or describing it, changes no text.
 */
export async function update(
	id: string,
	patch: DocumentComponentPatch,
	db: Db = getDb(),
): Promise<DocumentComponent> {
	const existing = await get(id, db);
	if (!existing) throw new Error("That component no longer exists.");
	const inputs = patch.inputs ?? existing.inputs;
	const read = checked(patch.root ?? existing.root, patch.fonts ?? existing.fonts);
	if (patch.root !== undefined || patch.inputs !== undefined || patch.fonts !== undefined) {
		assertSound(id, read.root, read.fonts, inputs, db);
	}
	const name = patch.name === undefined ? existing.name : patch.name.trim();
	if (!name) throw new Error("A component needs a name.");

	const [row] = db
		.update(documentComponents)
		.set({
			name,
			...(patch.description !== undefined ? { description: patch.description } : {}),
			rootJson: JSON.stringify(read.root),
			fontsJson: read.fonts.length > 0 ? JSON.stringify(read.fonts) : null,
			inputsJson: serialiseInputs(inputs),
			updatedAt: now(),
		})
		.where(eq(documentComponents.id, id))
		.returning()
		.all();

	// The text of a placing template is whatever this renders to, so each one is
	// compiled again and loses its review. A rename or a new description changes
	// no text, and is left out: the compiled body carries fresh ids every time,
	// so comparing it would call every edit a change.
	const affected = new Set((await usedBy(id, db)).map((use) => use.templateId));
	const before = checked(existing.root, existing.fonts);
	const textChanged =
		JSON.stringify(read.root) !== JSON.stringify(before.root) ||
		JSON.stringify(read.fonts) !== JSON.stringify(before.fonts) ||
		JSON.stringify(inputs) !== JSON.stringify(existing.inputs);
	if (textChanged) for (const templateId of affected) await templates.recompile(templateId, db);
	return { ...toComponent(row!)!, usedBy: affected.size };
}

/**
 * Removes a component. Refused while a template or another component places
 * it, with the names, because what is placed would stop printing. Take it off
 * those pages, or detach it there, first.
 */
export async function remove(id: string, db: Db = getDb()): Promise<DocumentComponent> {
	const existing = await get(id, db);
	if (!existing) throw new Error("That component no longer exists.");
	const uses = await usedBy(id, db);
	const parents = placedBy(id, db);
	if (uses.length > 0 || parents.length > 0) {
		const names = [...uses.map((use) => use.templateName), ...parents.map((parent) => `the component ${parent.name}`)];
		throw new Error(
			`"${existing.name}" is placed in ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}. ` +
				"Take it off those pages, or detach it there, before deleting it.",
		);
	}
	const [row] = db
		.update(documentComponents)
		.set({ deletedAt: now(), updatedAt: now() })
		.where(eq(documentComponents.id, id))
		.returning()
		.all();
	return { ...toComponent(row!)!, usedBy: 0 };
}

/**
 * Copies a placed component's nodes into a draft of a template and drops the
 * link, returning the draft. The component's pictures are copied into the
 * template too, so they keep working after the component is deleted. Nothing
 * is stored: the editor holds the result like any other edit.
 */
export async function detach(input: DetachInput, db: Db = getDb()): Promise<DetachResult> {
	const template = await templates.get(input.templateId, db);
	if (!template) throw new Error("That template no longer exists.");
	const canvas = input.canvas ?? template.canvas;
	if (!canvas) throw new Error("This template is not laid out on paper, so it has no components.");
	const inputs = input.inputs ?? template.inputs;
	const done = detachPlacement(canvas, inputs, input.nodeId, lookupFor(db));
	const copies = await assets.copyToTemplate(done.assetKeys, template.id, db);
	return { canvas: retargetAssets(done.canvas, input.nodeId, copies), inputs: done.inputs };
}

/** The same, written to the template, for an agent that has no editor to hold a draft. */
export async function detachAndSave(
	input: { templateId: string; nodeId: string },
	db: Db = getDb(),
): Promise<templates.DocumentTemplate> {
	const result = await detach(input, db);
	return templates.update(input.templateId, { canvas: result.canvas, inputs: result.inputs }, db);
}

/** What a component prints as on its own, for the editor's preview and for a check. */
export function renderAlone(
	input: { componentId: string; canvas?: DocumentCanvas; inputs?: TemplateInput[]; values: Record<string, string>; fontCss?: string },
	db: Db = getDb(),
): RenderResult {
	const row = db.select().from(documentComponents).where(eq(documentComponents.id, input.componentId)).get();
	const stored = row ? toComponent(row) : null;
	if (!stored && !input.canvas) throw new Error("That component no longer exists.");
	const canvas = input.canvas ?? componentCanvas(stored!.root, stored!.fonts);
	const inputs = input.inputs ?? stored?.inputs ?? [];
	return templates.renderCanvas({ ...input, canvas, inputs }, db);
}
