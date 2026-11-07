import type { NewRecordKind, NewRecordPrefill } from "./types";

/**
 * The address of a new-record window carries what it starts from, so the right
 * form paints on the first frame. Anything in an address can be edited by a
 * script in the page that opened it, so both ends run the same check and keep
 * only values of the right shape.
 */
export const NEW_RECORD_KINDS: NewRecordKind[] = ["event", "client", "project", "reminder"];

export function isNewRecordKind(value: string): value is NewRecordKind {
	return (NEW_RECORD_KINDS as string[]).includes(value);
}

const ID = /^[0-9a-zA-Z-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

/** Keeps the fields that have the right shape and drops the rest. */
export function cleanPrefill(input: unknown): NewRecordPrefill {
	if (typeof input !== "object" || input === null) return {};
	const source = input as Record<string, unknown>;
	const out: NewRecordPrefill = {};
	const text = (key: string, pattern: RegExp): string | undefined => {
		const value = source[key];
		return typeof value === "string" && pattern.test(value) ? value : undefined;
	};
	const clientId = text("clientId", ID);
	const projectId = text("projectId", ID);
	const date = text("date", DATE);
	const startLocal = text("startLocal", LOCAL);
	const endLocal = text("endLocal", LOCAL);
	if (clientId) out.clientId = clientId;
	if (projectId) out.projectId = projectId;
	if (date) out.date = date;
	if (startLocal) out.startLocal = startLocal;
	if (endLocal) out.endLocal = endLocal;
	if (source.allDay === true) out.allDay = true;
	return out;
}

export function prefillToQuery(prefill: NewRecordPrefill): string {
	const params = new URLSearchParams();
	const clean = cleanPrefill(prefill);
	for (const [key, value] of Object.entries(clean)) params.set(key, String(value));
	return params.toString();
}

export function prefillFromQuery(query: string): NewRecordPrefill {
	const params = new URLSearchParams(query);
	const raw: Record<string, unknown> = {};
	for (const [key, value] of params) raw[key] = key === "allDay" ? value === "true" : value;
	return cleanPrefill(raw);
}
