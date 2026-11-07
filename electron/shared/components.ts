/**
 * Components on a document template's canvas (decision 65): reading what a
 * placement stands for, and turning it into the nodes it stands for.
 *
 * Shared by the main process, which expands a canvas before it compiles, saves
 * or prints it, and the window, which draws a placement from the same nodes,
 * so the sheet in the editor and the PDF cannot disagree about what a
 * component holds. Pure on purpose: no node import, no DOM, no database. A
 * caller hands in a lookup for the components it has.
 *
 * A placement is a container with a `component` on it and no children of its
 * own. Expanding it replaces its content with a copy of the component's root:
 *
 * - every node of the copy gets a new id, so one component placed twice is two
 *   sets of nodes and never two nodes with the same id;
 * - the component's inputs are renamed in the copy. A value that is exactly
 *   `{{document.<key>}}` passes the template's own input through. Any other
 *   value is the text itself, and it never goes into the markup: the input is
 *   renamed to a key of its own and the text becomes that key's value, so it
 *   is escaped on the way into the page like anything a person typed;
 * - a component inside a component is expanded the same way, and one that
 *   contains itself, directly or through another, is refused.
 */
import type {
	ComponentPlacement,
	DocumentCanvas,
	DocumentComponent,
	MailContainer,
	MailFont,
	MailNode,
	TemplateInput,
} from "./types";

/** The most components inside components. A cycle is refused long before this. */
export const MAX_COMPONENT_DEPTH = 6;

const PASS_THROUGH = /^\{\{\s*document\.([a-z][a-z0-9_]*)\s*\}\}$/;
const DOCUMENT_PLACEHOLDER = /\{\{\s*document\.([a-z][a-z0-9_]*)\s*\}\}/g;
const ASSET_PLACEHOLDER = /\{\{\s*asset\.([a-f0-9]+)\s*\}\}/gi;

/** What a lookup has to give back for a component. */
export type ComponentSource = Pick<DocumentComponent, "id" | "name" | "root" | "fonts" | "inputs">;

export type ComponentLookup = (id: string) => ComponentSource | null;

/** The key a value passes through, or null when the value is text. */
export function passThroughKey(value: string): string | null {
	return PASS_THROUGH.exec(value.trim())?.[1] ?? null;
}

export function isPlacement(node: MailNode): node is MailContainer & { component: ComponentPlacement } {
	return node.kind === "container" && Boolean(node.component);
}

/** Every node in a list of nodes, at any depth, in order. */
export function walkNodes(nodes: MailNode[], visit: (node: MailNode) => void): void {
	for (const node of nodes) {
		visit(node);
		if (node.kind === "container") walkNodes(node.children, visit);
		else if (node.kind === "columns") {
			for (const row of node.rows) for (const cell of row.cells) walkNodes(cell.children, visit);
		}
	}
}

/** The ids of the components placed anywhere in these nodes, once each. */
export function componentIdsIn(nodes: MailNode[]): string[] {
	const ids = new Set<string>();
	walkNodes(nodes, (node) => {
		if (isPlacement(node)) ids.add(node.component.componentId);
	});
	return [...ids];
}

/** Applies `change` to every string in a value, keys excluded, and returns a copy. */
export function mapStrings<T>(value: T, change: (text: string) => string): T {
	if (typeof value === "string") return change(value) as unknown as T;
	if (Array.isArray(value)) return value.map((item) => mapStrings(item, change)) as unknown as T;
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) out[key] = mapStrings(inner, change);
		return out as T;
	}
	return value;
}

/** A copy with every `id` replaced, so the same nodes can sit in a layout twice. */
function withNewIds<T>(value: T): T {
	if (Array.isArray(value)) return value.map((item) => withNewIds(item)) as unknown as T;
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) {
			out[key] = key === "id" && typeof inner === "string" ? globalThis.crypto.randomUUID() : withNewIds(inner);
		}
		return out as T;
	}
	return value;
}

function slug(name: string): string {
	const base = name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
	return /^[a-z]/.test(base) ? base : `c_${base}`.replace(/_$/, "") || "component";
}

export type ExpandMode = "render" | "detach";

/** What expanding gathers on the way, handed back to the caller. */
export type Expansion = {
	/** Inputs the placements made, to add to the template's own when compiling. */
	inputs: TemplateInput[];
	/** Their values, for a render. Empty in `detach`, where they became default values. */
	fixed: Record<string, string>;
	/** Placements whose component is gone. Each is drawn as a marked gap. */
	missing: string[];
	fonts: MailFont[];
	/** The components that were placed, once each, so their pictures can be gathered. */
	components: string[];
};

type Context = {
	lookup: ComponentLookup;
	mode: ExpandMode;
	used: Set<string>;
	out: Expansion;
};

function freshKey(context: Context, base: string): string {
	let key = base;
	let n = 2;
	while (context.used.has(key)) key = `${base}_${n++}`;
	context.used.add(key);
	return key;
}

function missingMarker(placement: MailContainer): MailContainer {
	const html = "{{component.removed}}";
	return {
		...placement,
		component: null,
		children: [
			{
				id: globalThis.crypto.randomUUID(),
				kind: "text",
				tag: "p",
				grow: 0,
				alignSelf: "auto",
				hidden: false,
				actions: [],
				html,
				text: {
					color: null,
					fontFamily: null,
					fontSize: null,
					lineHeight: null,
					letterSpacing: null,
					weight: "normal",
					italic: false,
					decoration: "none",
					transform: "none",
					align: "left",
					verticalAlign: "top",
				},
				box: placement.box,
			},
		],
	};
}

/** The component's root as the placement draws it, its inputs renamed to what the placement gave them. */
function instance(source: ComponentSource, placement: ComponentPlacement, context: Context): MailContainer {
	const rename: Record<string, string> = {};
	for (const input of source.inputs) {
		const given = (placement.values[input.key] ?? "").trim();
		const through = passThroughKey(given);
		if (through) {
			rename[input.key] = through;
			continue;
		}
		const key = freshKey(context, `${slug(source.name)}_${input.key}`);
		rename[input.key] = key;
		const literal = given || input.defaultValue || "";
		if (context.mode === "render") {
			context.out.inputs.push({
				key,
				label: `${source.name}: ${input.label}`,
				kind: input.kind,
				required: false,
			});
			context.out.fixed[key] = literal;
		} else {
			context.out.inputs.push({
				...input,
				key,
				required: false,
				defaultValue: literal || null,
				source: null,
			});
		}
	}
	const renamed = mapStrings(source.root, (text) =>
		text.replace(DOCUMENT_PLACEHOLDER, (whole, key: string) => (rename[key] ? `{{document.${rename[key]}}}` : whole)),
	);
	const copy = withNewIds(fieldsRenamed(renamed, rename));
	for (const font of source.fonts) {
		if (!context.out.fonts.some((known) => known.family === font.family)) context.out.fonts.push(font);
	}
	return copy;
}

/** A declared input placed as a block names its key outside any text, so it is renamed on its own. */
function fieldsRenamed<T extends MailNode>(node: T, rename: Record<string, string>): T {
	const visit = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(visit);
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const [key, inner] of Object.entries(record)) out[key] = visit(inner);
			if (record.kind === "field" && typeof record.inputKey === "string" && rename[record.inputKey]) {
				out.inputKey = rename[record.inputKey];
			}
			return out;
		}
		return value;
	};
	return visit(node) as T;
}

function expandNodes(nodes: MailNode[], context: Context, stack: string[], once: boolean): MailNode[] {
	return nodes.map((node) => expandNode(node, context, stack, once));
}

function expandNode(node: MailNode, context: Context, stack: string[], once: boolean): MailNode {
	if (node.kind === "container") {
		if (isPlacement(node) && !node.hidden) {
			const placement = node.component;
			const source = context.lookup(placement.componentId);
			if (!source) {
				context.out.missing.push(placement.componentId);
				return missingMarker(node);
			}
			if (stack.includes(source.id) || stack.length >= MAX_COMPONENT_DEPTH) {
				throw new Error(`The component "${source.name}" contains itself. Take it out of the component.`);
			}
			if (!context.out.components.includes(source.id)) context.out.components.push(source.id);
			const root = instance(source, placement, context);
			const merged: MailContainer = {
				...root,
				id: node.id,
				name: node.name,
				hidden: node.hidden,
				alignSelf: node.alignSelf,
				grow: node.grow,
				actions: node.actions,
				box: { ...root.box, margin: node.box.margin },
				component: null,
			};
			delete merged.component;
			// Detaching copies one level and leaves a component inside it placed.
			return once ? merged : { ...merged, children: expandNodes(merged.children, context, [...stack, source.id], once) };
		}
		if (node.component) return node;
		return { ...node, children: expandNodes(node.children, context, stack, once) };
	}
	if (node.kind === "columns") {
		return {
			...node,
			rows: node.rows.map((row) => ({
				...row,
				cells: row.cells.map((cell) => ({ ...cell, children: expandNodes(cell.children, context, stack, once) })),
			})),
		};
	}
	return node;
}

function newContext(lookup: ComponentLookup, mode: ExpandMode, inputs: TemplateInput[]): Context {
	return {
		lookup,
		mode,
		used: new Set(inputs.map((input) => input.key)),
		out: { inputs: [], fixed: {}, missing: [], fonts: [], components: [] },
	};
}

/**
 * The canvas with every placed component replaced by its content, and what
 * that added: inputs, their values, fonts and any component that was gone.
 * Idempotent: a canvas with nothing placed comes back as it was.
 */
export function expandCanvas(
	canvas: DocumentCanvas,
	inputs: TemplateInput[],
	lookup: ComponentLookup,
): Expansion & { canvas: DocumentCanvas } {
	const context = newContext(lookup, "render", inputs);
	const children = expandNodes(canvas.layout.children, context, [], false);
	const fonts = [...canvas.layout.fonts];
	for (const font of context.out.fonts) if (!fonts.some((known) => known.family === font.family)) fonts.push(font);
	return { ...context.out, canvas: { ...canvas, layout: { ...canvas.layout, children, fonts } } };
}

/**
 * Replaces one placement with a copy of its component's nodes and drops the
 * link. A text a placement was given becomes an input of the template with
 * that text as its starting value. The nodes still name the component's
 * pictures by `{{asset.<key>}}`: `assetKeys` lists them, and the service that
 * copies the files rewrites the tokens (`mapStrings`) once it has new ones.
 */
export function detachPlacement(
	canvas: DocumentCanvas,
	inputs: TemplateInput[],
	nodeId: string,
	lookup: ComponentLookup,
): { canvas: DocumentCanvas; inputs: TemplateInput[]; assetKeys: string[]; detachedId: string } {
	const context = newContext(lookup, "detach", inputs);
	let found = false;
	const visit = (nodes: MailNode[]): MailNode[] =>
		nodes.map((node) => {
			if (node.id === nodeId && isPlacement(node)) {
				found = true;
				return expandNode(node, context, [], true);
			}
			if (node.kind === "container") return { ...node, children: visit(node.children) };
			if (node.kind === "columns") {
				return {
					...node,
					rows: node.rows.map((row) => ({
						...row,
						cells: row.cells.map((cell) => ({ ...cell, children: visit(cell.children) })),
					})),
				};
			}
			return node;
		});
	const children = visit(canvas.layout.children);
	if (!found) throw new Error("That is not a placed component. Select the component on the page and try again.");
	if (context.out.missing.length > 0) {
		throw new Error("That component no longer exists, so there is nothing to copy in. Delete it from the page instead.");
	}
	const fonts = [...canvas.layout.fonts];
	for (const font of context.out.fonts) if (!fonts.some((known) => known.family === font.family)) fonts.push(font);

	const keys = new Set<string>();
	const detached = findById(children, nodeId);
	if (detached) {
		mapStrings(detached, (text) => {
			for (const match of text.matchAll(ASSET_PLACEHOLDER)) keys.add(match[1]!.toLowerCase());
			return text;
		});
	}
	return {
		canvas: { ...canvas, layout: { ...canvas.layout, children, fonts } },
		inputs: [...inputs, ...context.out.inputs],
		assetKeys: [...keys],
		detachedId: nodeId,
	};
}

function findById(nodes: MailNode[], id: string): MailNode | null {
	let found: MailNode | null = null;
	walkNodes(nodes, (node) => {
		if (node.id === id) found = node;
	});
	return found;
}

/** Rewrites `{{asset.<old>}}` to a new key in one detached node of a canvas. */
export function retargetAssets(canvas: DocumentCanvas, nodeId: string, map: Record<string, string>): DocumentCanvas {
	const rewrite = (text: string) =>
		text.replace(ASSET_PLACEHOLDER, (whole, key: string) => (map[key.toLowerCase()] ? `{{asset.${map[key.toLowerCase()]}}}` : whole));
	const visit = (nodes: MailNode[]): MailNode[] =>
		nodes.map((node) => {
			if (node.id === nodeId) return mapStrings(node, rewrite);
			if (node.kind === "container") return { ...node, children: visit(node.children) };
			if (node.kind === "columns") {
				return {
					...node,
					rows: node.rows.map((row) => ({
						...row,
						cells: row.cells.map((cell) => ({ ...cell, children: visit(cell.children) })),
					})),
				};
			}
			return node;
		});
	return { ...canvas, layout: { ...canvas.layout, children: visit(canvas.layout.children) } };
}

/**
 * Whether a component's own content places `target`, directly or through
 * others. Used to refuse a cycle when a component is saved.
 */
export function placesComponent(
	nodes: MailNode[],
	target: string,
	lookup: ComponentLookup,
	seen: Set<string> = new Set(),
): boolean {
	for (const id of componentIdsIn(nodes)) {
		if (id === target) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		const inner = lookup(id);
		if (inner && placesComponent(inner.root.children, target, lookup, seen)) return true;
	}
	return false;
}

/**
 * One placement as the canvas draws it: the component's root with the
 * placement's own name, place and margin, and its inputs renamed. A component
 * inside it stays a placement, and is drawn the same way when the canvas comes
 * to it. Null when the component is gone, which the canvas says in words.
 */
export function drawPlacement(node: MailContainer, lookup: ComponentLookup): MailContainer | null {
	if (!isPlacement(node)) return null;
	const context = newContext(lookup, "render", []);
	const drawn = expandNode(node, context, [], true);
	if (context.out.missing.length > 0 || drawn.kind !== "container") return null;
	return drawn;
}
