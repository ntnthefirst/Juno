/**
 * Every element the toolbar can add, in the five groups it is drawn in.
 *
 * What is added is that HTML element: a container of the chosen tag, a text of
 * the chosen tag, a heading of the chosen level, a columns table, a picture,
 * a rule or a declared input. So the layers and the code view name it for what
 * it is, and its tag can be changed afterwards within its group in the design
 * panel.
 *
 * Each group is one button that adds the element used last from it, and a
 * chevron that opens the rest. The letters here are the whole keyboard side
 * of that, and `shortcuts.ts` builds its table and its list from them:
 *
 * - a group's own letter adds the group's last-used element;
 * - Shift with it opens the group's menu;
 * - in an open menu, an element's own key adds that element.
 */
import type { MailContainerTag, MailHeadingTag, MailLayout, MailNode, MailTextTag } from "@shared/types";
import type { IconName } from "../../../../components/Icon";
import { CONTAINER_TAG_LABELS, newBlock, newButtonText, newClick, newColumns, newContainer } from "./canvas-actions";

export type GroupId = "containers" | "text" | "columns" | "media" | "other";

export type ElementId =
	| MailContainerTag
	| MailHeadingTag
	| MailTextTag
	| "button"
	| "columns"
	| "image"
	| "linked-image"
	| "divider"
	| "field";

export type ElementInfo = {
	id: ElementId;
	/** What it is called in the menu. */
	label: string;
	/** The HTML it is written as, shown beside the name so the menu says what is added. */
	tag: string;
	/** One character, unique in its group: the key that adds it from the group's open menu. */
	key: string;
	icon: IconName;
};

export type GroupInfo = {
	id: GroupId;
	label: string;
	/** The group's own letter. Alone it adds the last-used element; with Shift it opens the menu. */
	key: string;
	/** What the group adds until something else has been used. */
	first: ElementId;
	elements: ElementInfo[];
};

const CONTAINER_KEYS: Record<MailContainerTag, string> = {
	section: "S",
	div: "D",
	header: "H",
	footer: "F",
	main: "M",
	article: "A",
	aside: "I",
	nav: "N",
};

const CONTAINER_TAGS = Object.keys(CONTAINER_KEYS) as MailContainerTag[];

export const GROUPS: GroupInfo[] = [
	{
		id: "containers",
		label: "Containers",
		key: "F",
		first: "section",
		elements: CONTAINER_TAGS.map((tag) => ({
			id: tag,
			label: CONTAINER_TAG_LABELS[tag],
			tag,
			key: CONTAINER_KEYS[tag],
			icon: "tool-section",
		})),
	},
	{
		id: "text",
		label: "Text",
		key: "T",
		first: "p",
		elements: [
			{ id: "h1", label: "Heading 1", tag: "h1", key: "1", icon: "h1" },
			{ id: "h2", label: "Heading 2", tag: "h2", key: "2", icon: "h2" },
			{ id: "h3", label: "Heading 3", tag: "h3", key: "3", icon: "h3" },
			{ id: "h4", label: "Heading 4", tag: "h4", key: "4", icon: "tool-heading" },
			{ id: "h5", label: "Heading 5", tag: "h5", key: "5", icon: "tool-heading" },
			{ id: "h6", label: "Heading 6", tag: "h6", key: "6", icon: "tool-heading" },
			{ id: "p", label: "Text", tag: "p", key: "P", icon: "tool-text" },
			{ id: "blockquote", label: "Quote", tag: "blockquote", key: "Q", icon: "tool-text" },
			{ id: "pre", label: "Preformatted", tag: "pre", key: "R", icon: "view-code" },
			{ id: "address", label: "Address", tag: "address", key: "A", icon: "tool-text" },
			{ id: "span", label: "Inline text", tag: "span", key: "S", icon: "tool-text" },
			{ id: "ul", label: "Bulleted list", tag: "ul", key: "U", icon: "list" },
			{ id: "ol", label: "Numbered list", tag: "ol", key: "O", icon: "list" },
			{ id: "button", label: "Button", tag: "a > p", key: "B", icon: "tool-button" },
		],
	},
	{
		id: "columns",
		label: "Columns",
		key: "C",
		first: "columns",
		elements: [{ id: "columns", label: "Columns", tag: "table", key: "C", icon: "tool-columns" }],
	},
	{
		id: "media",
		label: "Media",
		key: "I",
		first: "image",
		elements: [
			{ id: "image", label: "Picture", tag: "img", key: "I", icon: "image" },
			{ id: "linked-image", label: "Linked picture", tag: "a > img", key: "L", icon: "link" },
		],
	},
	{
		id: "other",
		label: "Other",
		key: "E",
		first: "field",
		elements: [
			{ id: "divider", label: "Divider", tag: "hr", key: "D", icon: "tool-divider" },
			{ id: "field", label: "Input", tag: "input", key: "I", icon: "tool-input" },
		],
	},
];

/** The heading key, which adds one element and belongs to no menu of its own. */
export const HEADING_KEY = "H";

export const MEDIA_NOTE =
	"Video, audio and embeds play in no client that matters, so use a picture that links to where the video plays.";

export function groupInfo(id: GroupId): GroupInfo {
	const found = GROUPS.find((group) => group.id === id);
	if (!found) throw new Error(`No group ${id}`);
	return found;
}

/** The group an element is in, and its entry there. */
export function elementInfo(id: ElementId): { group: GroupInfo; element: ElementInfo } {
	for (const group of GROUPS) {
		const element = group.elements.find((entry) => entry.id === id);
		if (element) return { group, element };
	}
	throw new Error(`No element ${id}`);
}

/** The parts of a key press an open menu reads. */
export type MenuPress = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey">;

/**
 * The element a key picks in a group's open menu, or null. Shift is ignored,
 * because the menu was opened with it and a finger is often still on it; Ctrl,
 * Cmd and Alt are not, so a menu never swallows a shortcut that is not its own.
 */
export function elementForKey(group: GroupId, press: MenuPress): ElementId | null {
	if (press.ctrlKey || press.metaKey || press.altKey) return null;
	const letter = /^Key([A-Z])$/.exec(press.code);
	const digit = /^Digit([0-9])$/.exec(press.code);
	const key = letter?.[1] ?? digit?.[1] ?? null;
	if (!key) return null;
	return groupInfo(group).elements.find((element) => element.key === key)?.id ?? null;
}

/* --------------------------------------------------------------- last used */

export type LastUsed = Record<GroupId, ElementId>;

const LAST_KEY = "juno.mailTemplates.lastElements";

export function defaultLastUsed(): LastUsed {
	return Object.fromEntries(GROUPS.map((group) => [group.id, group.first])) as LastUsed;
}

/**
 * What each group added last, remembered per machine like the autosave switch:
 * a habit about how somebody works, not a property of one template. Anything
 * unreadable, or naming an element the group does not have, is the default.
 */
export function readLastUsed(): LastUsed {
	const last = defaultLastUsed();
	try {
		const raw: unknown = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? "null");
		if (raw && typeof raw === "object") {
			for (const group of GROUPS) {
				const stored = (raw as Record<string, unknown>)[group.id];
				if (group.elements.some((element) => element.id === stored)) last[group.id] = stored as ElementId;
			}
		}
	} catch {
		// Storage blocked or holding something else: the defaults stand.
	}
	return last;
}

export function writeLastUsed(last: LastUsed): void {
	try {
		window.localStorage.setItem(LAST_KEY, JSON.stringify(last));
	} catch {
		// Only the memory of it is lost; the toolbar still works this session.
	}
}

/* ------------------------------------------------------------ what is added */

/** The element itself, ready to insert: a new node with new ids, named against what the layout already has. */
export function newElement(layout: MailLayout, id: ElementId): MailNode {
	if (id === "columns") return newColumns(layout);
	if (id === "image") return newBlock("image");
	if (id === "button") return newButtonText();
	if (id === "linked-image") {
		// A picture with an on-click action still to be filled in. An action with
		// no usable address compiles as a plain picture, so nothing is sent as a
		// link that goes nowhere.
		return { ...newBlock("image"), actions: [newClick()] };
	}
	if (id === "divider") return { ...newBlock("divider"), grow: 0 };
	if (id === "field") return newBlock("field");
	if (/^h[1-6]$/.test(id)) {
		const heading = newBlock("heading");
		return heading.kind === "heading" ? { ...heading, tag: id as MailHeadingTag } : heading;
	}
	const container = CONTAINER_TAGS.find((tag) => tag === id);
	if (container) return newContainer(layout, container);
	const text = newBlock("text");
	if (text.kind !== "text") return text;
	const tag = id as MailTextTag;
	return { ...text, tag, html: tag === "ul" || tag === "ol" ? "<li>Punt</li>" : "Tekst" };
}
