import { isNewRecordKind, prefillFromQuery } from "@shared/new-record";
import type { NewRecordKind, NewRecordPrefill, SettingsSection } from "@shared/types";

/**
 * Which shell this window is, read from its own URL.
 *
 * The main process puts the view in the hash when it creates the window
 * (electron/main/windows/chrome.ts), so the right shell paints on the first
 * frame instead of after a round trip, and a locked application still knows
 * what it is drawing.
 */
export type WindowView =
	| { kind: "main" }
	| { kind: "settings"; section: SettingsSection | null }
	| { kind: "setup" }
	| { kind: "new"; record: NewRecordKind; prefill: NewRecordPrefill };

const SECTIONS: SettingsSection[] = ["general", "business", "mail", "documents", "security", "mcp"];

export function isSettingsSection(value: string): value is SettingsSection {
	return (SECTIONS as string[]).includes(value);
}

export function viewFromHash(hash: string): WindowView {
	const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
	const parts = path.split("/");
	if (parts[0] === "new") {
		const record = parts[1] ?? "";
		if (isNewRecordKind(record)) return { kind: "new", record, prefill: prefillFromQuery(query) };
		return { kind: "main" };
	}
	if (parts[0] === "setup") return { kind: "setup" };
	if (parts[0] === "settings") {
		const section = parts[1] ?? "";
		return { kind: "settings", section: isSettingsSection(section) ? section : null };
	}
	return { kind: "main" };
}
