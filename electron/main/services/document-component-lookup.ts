/**
 * Reading components back, for the code that has to draw one: the template
 * service when it compiles, saves and prints, and the component service
 * itself. Kept apart from document-components.ts because that module needs the
 * template service and the template service needs this, and a module cannot
 * wait for one that waits for it.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { ComponentLookup, ComponentSource } from "../../shared/components";
import type { DocumentComponent, MailContainer, MailFont, TemplateInput } from "../../shared/types";
import { getDb, type Db } from "../db";
import { documentComponents } from "../db/schema";
import { normaliseLayout } from "./mail-layout";
import { parseInputs } from "./template-inputs";

export type ComponentRow = typeof documentComponents.$inferSelect;

/** A container and its fonts through the layout reader, which is what decides what is valid. */
export function readRoot(raw: unknown, fonts: unknown = []): { root: MailContainer; fonts: MailFont[] } | null {
	const layout = normaliseLayout({
		version: 2,
		width: 0,
		widthMode: "fixed",
		minHeight: 0,
		fill: null,
		fonts,
		customCss: null,
		children: [raw],
		breakpoints: [],
	});
	const root = layout?.children[0];
	if (!layout || !root || root.kind !== "container") return null;
	return { root, fonts: layout.fonts };
}

function parseJson(json: string | null): unknown {
	if (!json) return null;
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

export function toComponent(row: ComponentRow, usedBy = 0): DocumentComponent | null {
	const read = readRoot(parseJson(row.rootJson), parseJson(row.fontsJson) ?? []);
	if (!read) return null;
	return {
		id: row.id,
		ownerId: row.ownerId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
		name: row.name,
		description: row.description,
		root: read.root,
		fonts: read.fonts,
		inputs: parseInputs(row.inputsJson),
		usedBy,
	};
}

/** Live components by id. A deleted component is not placed, so it is not found. */
export function lookupFor(db: Db = getDb()): ComponentLookup {
	const cache = new Map<string, ComponentSource | null>();
	return (id) => {
		if (cache.has(id)) return cache.get(id) ?? null;
		const row = db
			.select()
			.from(documentComponents)
			.where(and(eq(documentComponents.id, id), isNull(documentComponents.deletedAt)))
			.get();
		const component = row ? toComponent(row) : null;
		const source = component
			? { id: component.id, name: component.name, root: component.root, fonts: component.fonts, inputs: component.inputs as TemplateInput[] }
			: null;
		cache.set(id, source);
		return source;
	};
}
