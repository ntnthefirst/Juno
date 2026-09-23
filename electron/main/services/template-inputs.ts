/**
 * Declared inputs: what a document or mail template asks for beyond what a
 * client and project record already answer.
 *
 * Shared by document-templates.ts and mail-templates.ts, so the storage shape,
 * the validation and the key rule are the same for both rather than drifting
 * apart the moment one of them is edited on its own.
 *
 * Pure: no Electron import, no database import. Both template services and
 * their tests can use it without a connection.
 */
import type { TemplateInput, TemplateInputKind } from "../../shared/types";

const KINDS: TemplateInputKind[] = ["text", "textarea", "number", "money", "date", "choice"];

/**
 * A key becomes `{{document.<key>}}` in a body, and the tiny template language
 * in template-render.ts resolves a path by splitting on dots and looking up
 * plain object keys. A dotted, spaced or capitalised key would either resolve
 * to the wrong thing or never resolve at all, silently, which is worse than
 * refusing it up front.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Reads the stored JSON back into declared inputs. Never throws: a row whose
 * `inputs_json` cannot be parsed behaves as though it asks for nothing, rather
 * than failing to load at all.
 */
export function parseInputs(json: string | null): TemplateInput[] {
	if (!json) return [];

	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) return [];

	const inputs: TemplateInput[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const key = typeof entry.key === "string" ? entry.key.trim() : "";
		if (!key) continue;

		const kind = KINDS.includes(entry.kind as TemplateInputKind)
			? (entry.kind as TemplateInputKind)
			: "text";
		const label = typeof entry.label === "string" ? entry.label : "";
		const required = entry.required === true;

		const input: TemplateInput = { key, label, kind, required };
		if (typeof entry.help === "string") input.help = entry.help;
		if (typeof entry.defaultValue === "string") input.defaultValue = entry.defaultValue;
		if (kind === "choice" && Array.isArray(entry.options)) {
			const options = entry.options.filter((option): option is string => typeof option === "string");
			if (options.length > 0) input.options = options;
		}
		inputs.push(input);
	}
	return inputs;
}

/** Null rather than "[]", so a template that asks nothing keeps its column empty. */
export function serialiseInputs(inputs: TemplateInput[]): string | null {
	if (inputs.length === 0) return null;
	return JSON.stringify(inputs);
}

/**
 * Throws when a declared input cannot work. Each message names the key that is
 * wrong and says what to change, because an editor screen shows it as-is.
 */
export function validateInputs(inputs: TemplateInput[]): void {
	const seen = new Set<string>();
	for (const raw of inputs) {
		const key = raw.key.trim();
		if (!key) {
			throw new Error("An input needs a key. Give it a short name such as scope or amount.");
		}
		if (!KEY_PATTERN.test(key)) {
			throw new Error(
				`The key "${key}" is not valid. Use only lowercase letters, digits and underscores, ` +
					`starting with a letter, because it becomes {{document.${key}}} in the body and anything ` +
					"else never resolves.",
			);
		}
		if (seen.has(key)) {
			throw new Error(`Two inputs share the key "${key}". Give each one its own key.`);
		}
		seen.add(key);

		if (!raw.label.trim()) {
			throw new Error(`The input "${key}" needs a label, so the person filling it in knows what it asks.`);
		}
		if (raw.kind === "choice" && (!raw.options || raw.options.length < 1)) {
			throw new Error(`The input "${key}" is a choice and needs at least one option. Add one.`);
		}
	}
}

/**
 * Trims what was typed against a template and reports which required inputs
 * are still blank. Never throws: the caller decides whether a missing value
 * should stop a render or only be reported alongside it.
 */
export function validateValues(
	inputs: TemplateInput[],
	values: Record<string, string>,
): { values: Record<string, string>; missing: string[] } {
	const trimmed: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		trimmed[key] = typeof value === "string" ? value.trim() : "";
	}

	const missing: string[] = [];
	for (const input of inputs) {
		if (!input.required) continue;
		if (!trimmed[input.key]) missing.push(input.key);
	}

	return { values: trimmed, missing };
}
