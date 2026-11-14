import { DEFAULT_SORT, type ExplorerSort, type SortColumn } from "./explorer-items";
import { ROOT_KEY } from "./explorer-tree";

/**
 * How the explorer was left: list or tiles, the nodes that were open in the
 * tree, the folder that was open, the order and whether a preview shows its
 * details column. A convenience for this window only, so it lives in the
 * page's own storage and a storage that refuses (a private profile, a full
 * disk) only means the explorer opens the way it does the first time.
 */
export type ExplorerPrefs = {
	view: "list" | "grid";
	expanded: string[];
	openKey: string;
	sort: ExplorerSort;
	details: boolean;
};

const KEY = "juno.documents.explorer";

const DEFAULTS: ExplorerPrefs = { view: "list", expanded: [], openKey: ROOT_KEY, sort: DEFAULT_SORT, details: true };

const COLUMNS: readonly SortColumn[] = ["name", "type", "size", "modified"];

export function readPrefs(): ExplorerPrefs {
	try {
		const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
		if (typeof raw !== "object" || raw === null) return DEFAULTS;
		const value = raw as Record<string, unknown>;
		const sort = value["sort"] as Record<string, unknown> | undefined;
		return {
			view: value["view"] === "grid" ? "grid" : "list",
			expanded: Array.isArray(value["expanded"])
				? (value["expanded"] as unknown[]).filter((key): key is string => typeof key === "string").slice(0, 500)
				: [],
			openKey: typeof value["openKey"] === "string" ? value["openKey"] : ROOT_KEY,
			sort:
				sort && COLUMNS.includes(sort["by"] as SortColumn)
					? { by: sort["by"] as SortColumn, descending: sort["descending"] === true }
					: DEFAULT_SORT,
			details: value["details"] !== false,
		};
	} catch {
		return DEFAULTS;
	}
}

export function writePrefs(patch: Partial<ExplorerPrefs>): void {
	try {
		window.localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...patch }));
	} catch {
		// Not remembered this time; nothing else depends on it.
	}
}
