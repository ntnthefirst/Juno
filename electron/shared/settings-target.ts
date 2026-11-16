import type { SettingsTarget } from "./types";

// An account id is a UUIDv7, so anything else is refused before it reaches a URL.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A settings target that came from a renderer or out of an address, checked.
 * Both ends run it: the main process before the target goes into the settings
 * window's URL, and the settings window when it reads that URL back, since a
 * script in the page that asked could have edited either.
 */
export function cleanSettingsTarget(value: unknown): SettingsTarget | null {
	if (typeof value !== "object" || value === null) return null;
	const target = value as { kind?: unknown; accountId?: unknown };
	if (target.kind === "add-calendar") return { kind: "add-calendar" };
	if (target.kind === "new-rule" && typeof target.accountId === "string" && ID.test(target.accountId)) {
		return { kind: "new-rule", accountId: target.accountId };
	}
	return null;
}

/** The query that carries a target in the settings window's address. */
export function settingsTargetQuery(target: SettingsTarget): string {
	const params = new URLSearchParams({ open: target.kind });
	if (target.kind === "new-rule") params.set("account", target.accountId);
	return params.toString();
}

/** A target read back out of the settings window's address. */
export function settingsTargetFromQuery(query: string): SettingsTarget | null {
	const params = new URLSearchParams(query);
	return cleanSettingsTarget({ kind: params.get("open"), accountId: params.get("account") ?? undefined });
}
