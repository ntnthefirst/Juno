/**
 * Breakpoints on the canvas: what one looks like, and how an edit made while
 * one is selected becomes what that breakpoint changes.
 *
 * The model (electron/shared/types.ts, MailBreakpoint) keeps only what a
 * breakpoint changes, keyed by id, and a narrower breakpoint starts from the
 * wider ones, the way `max-width` media queries stack in a mail client. The
 * applying half mirrors `layoutAt` in electron/main/services/mail-layout.ts,
 * because the renderer cannot import from electron/main (architecture.md
 * section 7); the compiler is still what writes the media queries, so a drift
 * here shows as a canvas that disagrees with the preview.
 *
 * The editing half works on whole canvases, which is what lets every control
 * in the design panel stay as it is. The panel is handed the canvas as the
 * selected breakpoint draws it and changes that, and `absorb` compares the
 * result with what the wider breakpoints already make of it: whatever differs
 * in how something looks is what this breakpoint changes, and whatever differs
 * in what it says goes to the default, because the words are the same at
 * every width.
 */
import type {
	MailBlock,
	MailBlockOverride,
	MailBreakpoint,
	MailLayout,
	MailSection,
	MailSectionOverride,
} from "@shared/types";
import { newId } from "./canvas-actions";

/** Matches KIND_STYLE in services/mail-layout.ts: what a breakpoint may change beyond the common three. */
const KIND_STYLE: Record<MailBlock["kind"], (keyof MailBlockOverride)[]> = {
	text: [],
	heading: [],
	button: ["background", "color", "radius"],
	image: ["width", "align"],
	divider: ["color", "thickness"],
	spacer: ["height"],
	field: [],
	html: [],
};

const COMMON_STYLE: (keyof MailBlockOverride)[] = ["hidden", "grow", "alignSelf"];

/** What a block says or shows, which is the same at every width. */
const CONTENT: Record<MailBlock["kind"], string[]> = {
	text: ["html"],
	heading: ["content", "level"],
	button: ["label", "href"],
	image: ["src", "alt"],
	divider: [],
	spacer: [],
	field: ["inputKey"],
	html: ["html", "css"],
};

/** The breakpoints a narrower one can be, and what each is called when it is added. */
const LADDER = [
	{ width: 480, name: "Phone" },
	{ width: 360, name: "Small phone" },
	{ width: 768, name: "Tablet" },
	{ width: 320, name: "Narrow" },
];

const MAX_BREAKPOINTS = 4;
const MIN_WIDTH = 200;
const MAX_WIDTH = 1600;

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
	return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** Matches widestFirst in services/mail-layout.ts. */
export function widestFirst(breakpoints: MailBreakpoint[]): MailBreakpoint[] {
	return breakpoints
		.map((breakpoint, index) => ({ breakpoint, index }))
		.sort((a, b) => b.breakpoint.maxWidth - a.breakpoint.maxWidth || a.index - b.index)
		.map((entry) => entry.breakpoint);
}

/** Matches applyBlockOverride in services/mail-layout.ts. */
function applyBlock(block: MailBlock, override: MailBlockOverride | undefined): MailBlock {
	if (!override) return block;
	const { box, text, ...top } = override;
	return {
		...block,
		...top,
		...(box && "box" in block ? { box: { ...block.box, ...box } } : {}),
		...(text && "text" in block ? { text: { ...block.text, ...text } } : {}),
	} as MailBlock;
}

function applySection(section: MailSection, breakpoint: MailBreakpoint): MailSection {
	const { box, ...top } = own(breakpoint.sections, section.id) ?? ({} as MailSectionOverride);
	return {
		...section,
		...top,
		box: box ? { ...section.box, ...box } : section.box,
		blocks: section.blocks.map((block) => applyBlock(block, own(breakpoint.blocks, block.id))),
	};
}

/**
 * The canvas as the breakpoint `id` draws it, at its width; the default with
 * no id. `through` false stops short of the breakpoint itself, which is what
 * it is compared against when it is edited.
 */
function drawnAt(layout: MailLayout, id: string | null, through: boolean): MailLayout {
	if (!id || !layout.breakpoints.some((breakpoint) => breakpoint.id === id)) return layout;
	let sections = layout.sections;
	let width = layout.width;
	for (const breakpoint of widestFirst(layout.breakpoints)) {
		if (breakpoint.id === id && !through) break;
		sections = sections.map((section) => applySection(section, breakpoint));
		width = breakpoint.maxWidth;
		if (breakpoint.id === id) break;
	}
	return { ...layout, width, sections };
}

/** Matches layoutAt in services/mail-layout.ts. */
export function layoutAt(layout: MailLayout, id: string | null): MailLayout {
	return drawnAt(layout, id, true);
}

function diffBlock(next: MailBlock, was: MailBlock): MailBlockOverride | null {
	const override: Record<string, unknown> = {};
	const after = next as unknown as Record<string, unknown>;
	const before = was as unknown as Record<string, unknown>;
	for (const key of [...COMMON_STYLE, ...KIND_STYLE[next.kind]]) {
		if (!same(after[key], before[key])) override[key] = after[key];
	}
	if ("box" in next && "box" in was) {
		const box = Object.fromEntries(
			Object.entries(next.box).filter(([key, value]) => !same(value, was.box[key as keyof typeof was.box])),
		);
		if (Object.keys(box).length > 0) override.box = box;
	}
	if ("text" in next && "text" in was) {
		const text = Object.fromEntries(
			Object.entries(next.text).filter(([key, value]) => !same(value, was.text[key as keyof typeof was.text])),
		);
		if (Object.keys(text).length > 0) override.text = text;
	}
	return Object.keys(override).length > 0 ? (override as MailBlockOverride) : null;
}

function diffSection(next: MailSection, was: MailSection): MailSectionOverride | null {
	const override: MailSectionOverride = {};
	if (next.hidden !== was.hidden) override.hidden = next.hidden;
	if (next.alignSelf !== was.alignSelf) override.alignSelf = next.alignSelf;
	if (!same(next.layout, was.layout)) override.layout = next.layout;
	const box = Object.fromEntries(
		Object.entries(next.box).filter(([key, value]) => !same(value, was.box[key as keyof typeof was.box])),
	);
	if (Object.keys(box).length > 0) override.box = box;
	return Object.keys(override).length > 0 ? override : null;
}

/** The block with what `next` says or shows, and its own look. */
function withContent(block: MailBlock, next: MailBlock): MailBlock {
	if (block.kind !== next.kind) return block;
	const after = next as unknown as Record<string, unknown>;
	return { ...block, ...Object.fromEntries(CONTENT[block.kind].map((key) => [key, after[key]])) } as MailBlock;
}

/**
 * A canvas edited while the breakpoint `id` was selected, folded back into the
 * layout: how things look becomes what the breakpoint changes, measured
 * against the wider breakpoints and the default, and what they say goes to
 * the default. The frame is the same at every width except its own width,
 * which at a breakpoint is the breakpoint's.
 *
 * With no breakpoint selected the edit is the layout.
 */
export function absorb(layout: MailLayout, id: string | null, next: MailLayout): MailLayout {
	const breakpoint = id ? layout.breakpoints.find((entry) => entry.id === id) : undefined;
	if (!breakpoint) return next;
	const before = drawnAt(layout, breakpoint.id, false);
	const drawn = layoutAt(layout, breakpoint.id);
	const sectionOverrides: Record<string, MailSectionOverride> = {};
	const blockOverrides: Record<string, MailBlockOverride> = {};

	const sections = layout.sections.map((section) => {
		const edited = next.sections.find((entry) => entry.id === section.id);
		const was = before.sections.find((entry) => entry.id === section.id);
		if (!edited || !was) return section;
		const sectionOverride = diffSection(edited, was);
		if (sectionOverride) sectionOverrides[section.id] = sectionOverride;
		return {
			...section,
			name: edited.name,
			blocks: section.blocks.map((block) => {
				const editedBlock = edited.blocks.find((entry) => entry.id === block.id);
				const wasBlock = was.blocks.find((entry) => entry.id === block.id);
				if (!editedBlock || !wasBlock || editedBlock.kind !== block.kind) return block;
				const blockOverride = diffBlock(editedBlock, wasBlock);
				if (blockOverride) blockOverrides[block.id] = blockOverride;
				return withContent(block, editedBlock);
			}),
		};
	});

	return {
		...next,
		width: layout.width,
		sections,
		breakpoints: layout.breakpoints.map((entry) =>
			entry.id === breakpoint.id
				? {
						...entry,
						maxWidth: next.width !== drawn.width ? clampWidth(next.width) : entry.maxWidth,
						sections: sectionOverrides,
						blocks: blockOverrides,
					}
				: entry,
		),
	};
}

function clampWidth(width: number): number {
	return Math.round(Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH));
}

/**
 * A new breakpoint, narrower than the ones there are. It changes nothing yet,
 * so it starts as a copy of what the widths above it draw.
 */
export function addBreakpoint(layout: MailLayout): { layout: MailLayout; id: string } | null {
	if (layout.breakpoints.length >= MAX_BREAKPOINTS) return null;
	const taken = new Set([layout.width, ...layout.breakpoints.map((breakpoint) => breakpoint.maxWidth)]);
	const narrowest = Math.min(layout.width, ...layout.breakpoints.map((breakpoint) => breakpoint.maxWidth));
	const pick =
		LADDER.find((step) => !taken.has(step.width) && step.width < narrowest) ??
		LADDER.find((step) => !taken.has(step.width) && step.width < layout.width) ?? {
			width: clampWidth(narrowest - 40),
			name: `${clampWidth(narrowest - 40)}`,
		};
	const breakpoint: MailBreakpoint = { id: newId(), name: pick.name, maxWidth: pick.width, sections: {}, blocks: {} };
	return { layout: { ...layout, breakpoints: [...layout.breakpoints, breakpoint] }, id: breakpoint.id };
}

export function removeBreakpoint(layout: MailLayout, id: string): MailLayout {
	return { ...layout, breakpoints: layout.breakpoints.filter((breakpoint) => breakpoint.id !== id) };
}

export function renameBreakpoint(layout: MailLayout, id: string, name: string): MailLayout {
	const clean = name.trim().slice(0, 40);
	if (!clean) return layout;
	return {
		...layout,
		breakpoints: layout.breakpoints.map((breakpoint) => (breakpoint.id === id ? { ...breakpoint, name: clean } : breakpoint)),
	};
}

export function resizeBreakpoint(layout: MailLayout, id: string, width: number): MailLayout {
	return {
		...layout,
		breakpoints: layout.breakpoints.map((breakpoint) =>
			breakpoint.id === id ? { ...breakpoint, maxWidth: clampWidth(width) } : breakpoint,
		),
	};
}

/**
 * Gives copies what their originals change at each breakpoint, so a block
 * duplicated while looking at the phone looks on the phone the way the one it
 * was copied from does. `pairs` is original id to copy id.
 */
export function copyOverrides(layout: MailLayout, pairs: [string, string][]): MailLayout {
	if (layout.breakpoints.length === 0 || pairs.length === 0) return layout;
	return {
		...layout,
		breakpoints: layout.breakpoints.map((breakpoint) => {
			const sections = { ...breakpoint.sections };
			const blocks = { ...breakpoint.blocks };
			for (const [from, to] of pairs) {
				const sectionOverride = own(breakpoint.sections, from);
				if (sectionOverride) sections[to] = structuredClone(sectionOverride);
				const blockOverride = own(breakpoint.blocks, from);
				if (blockOverride) blocks[to] = structuredClone(blockOverride);
			}
			return { ...breakpoint, sections, blocks };
		}),
	};
}
