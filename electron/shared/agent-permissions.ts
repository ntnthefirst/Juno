/**
 * The five rows of the permissions page, and what each may be set to.
 *
 * Pure data and two small functions, so the settings store, the service that
 * enforces the levels and the page that draws them all read one definition.
 * Which tool belongs to which row is in `main/services/agent-permissions.ts`.
 */
import type {
	AgentInstructionArea,
	AgentInstructions,
	AgentLevel,
	AgentPermissionKind,
	AgentPermissionRow,
	AgentPermissions,
} from "./types";

export const PERMISSION_KINDS: AgentPermissionKind[] = ["read", "change", "drafts", "send", "delete"];

export const AGENT_LEVELS: AgentLevel[] = ["off", "ask", "allow"];

export const PERMISSION_ROWS: AgentPermissionRow[] = [
	{
		kind: "read",
		label: "Read everything",
		description: "Clients, projects, documents, notes and mail.",
		locked: false,
	},
	{
		kind: "change",
		label: "Change records and notes",
		description: "Add and edit. Each change waits for you.",
		locked: false,
	},
	{
		kind: "drafts",
		label: "Write mail drafts",
		description: "Drafts open in the editor. Nothing is sent.",
		locked: false,
	},
	{
		kind: "send",
		label: "Send mail, sign and file",
		description: "Always shown to you in full first.",
		locked: true,
	},
	{
		kind: "delete",
		label: "Delete",
		description: "Always asks, one thing at a time.",
		locked: true,
	},
];

export const DEFAULT_PERMISSIONS: AgentPermissions = {
	read: "allow",
	change: "ask",
	drafts: "allow",
	send: "ask",
	delete: "ask",
};

/** Sending, signing, filing and deleting never run without a person, whatever is stored. */
export const LOCKED_KINDS: AgentPermissionKind[] = ["send", "delete"];

export function isLocked(kind: AgentPermissionKind): boolean {
	return LOCKED_KINDS.includes(kind);
}

/**
 * Reads whatever the file holds into a usable set. A locked row that was
 * written as "allow", by hand or by a bug, comes back as "ask": the file is
 * not trusted to keep the rule.
 */
export function normalisePermissions(raw: unknown): AgentPermissions {
	const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const next = { ...DEFAULT_PERMISSIONS };
	for (const kind of PERMISSION_KINDS) {
		const value = source[kind];
		if (typeof value === "string" && AGENT_LEVELS.includes(value as AgentLevel)) {
			next[kind] = value as AgentLevel;
		}
		if (isLocked(kind) && next[kind] === "allow") next[kind] = "ask";
	}
	return next;
}

/** The areas the "Add instructions for another area" button offers. */
export const INSTRUCTION_AREAS: { id: string; label: string }[] = [
	{ id: "clients", label: "Clients" },
	{ id: "projects", label: "Projects" },
	{ id: "documents", label: "Documents" },
	{ id: "calendar", label: "Calendar" },
	{ id: "reminders", label: "Reminders" },
];

export const MAX_INSTRUCTION_LENGTH = 4000;

export const DEFAULT_INSTRUCTIONS: AgentInstructions = { everyone: "", mail: "", areas: [] };

function text(value: unknown): string {
	return typeof value === "string" ? value.slice(0, MAX_INSTRUCTION_LENGTH) : "";
}

export function normaliseInstructions(raw: unknown): AgentInstructions {
	const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const known = new Set(INSTRUCTION_AREAS.map((entry) => entry.id));
	const areas: AgentInstructionArea[] = [];
	if (Array.isArray(source.areas)) {
		for (const entry of source.areas) {
			if (typeof entry !== "object" || entry === null) continue;
			const area = (entry as Record<string, unknown>).area;
			if (typeof area !== "string" || !known.has(area) || areas.some((have) => have.area === area)) continue;
			areas.push({ area, text: text((entry as Record<string, unknown>).text) });
		}
	}
	return { everyone: text(source.everyone), mail: text(source.mail), areas };
}

/**
 * The text a client reads when it connects. Empty when nothing was written, so
 * a person who never opens the page changes nothing about the handshake.
 */
export function instructionsText(instructions: AgentInstructions): string {
	const parts: string[] = [];
	const add = (heading: string, body: string) => {
		if (body.trim()) parts.push(`${heading}\n${body.trim()}`);
	};
	add("For every task:", instructions.everyone);
	add("For mail:", instructions.mail);
	for (const entry of instructions.areas) {
		const label = INSTRUCTION_AREAS.find((area) => area.id === entry.area)?.label ?? entry.area;
		add(`For ${label.toLowerCase()}:`, entry.text);
	}
	if (parts.length === 0) return "";
	return `The owner of this Juno installation asks you to follow these instructions.\n\n${parts.join("\n\n")}`;
}
