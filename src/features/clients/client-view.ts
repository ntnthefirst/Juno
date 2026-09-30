import type { ClientSummary } from "@shared/types";

export type ClientColumn = "name" | "status" | "city" | "projects";
export type SortDirection = "asc" | "desc";

export type Range = { min: number | null; max: number | null };

export type ClientView = {
	sort: { column: ClientColumn; direction: SortDirection } | null;
	/** Status ids. The empty string stands for a client with no status. */
	statuses: string[];
	/** City names. The empty string stands for a client with no city. */
	cities: string[];
	openProjects: Range;
	totalProjects: Range;
};

export const NO_STATUS = "";
export const NO_CITY = "";

export const EMPTY_VIEW: ClientView = {
	sort: null,
	statuses: [],
	cities: [],
	openProjects: { min: null, max: null },
	totalProjects: { min: null, max: null },
};

const collator = new Intl.Collator("nl-BE", { sensitivity: "base", numeric: true });

function inRange(value: number, range: Range): boolean {
	return (range.min === null || value >= range.min) && (range.max === null || value <= range.max);
}

function rangeActive(range: Range): boolean {
	return range.min !== null || range.max !== null;
}

/** Whether a column's filter is narrowing the list. Name has none. */
export function filterActive(view: ClientView, column: ClientColumn): boolean {
	if (column === "status") return view.statuses.length > 0;
	if (column === "city") return view.cities.length > 0;
	if (column === "projects") return rangeActive(view.openProjects) || rangeActive(view.totalProjects);
	return false;
}

export function anyFilterActive(view: ClientView): boolean {
	return (["status", "city", "projects"] as const).some((column) => filterActive(view, column));
}

/** Off to ascending to descending and back to off, the order a header click steps through. */
export function nextSort(view: ClientView, column: ClientColumn): ClientView["sort"] {
	if (view.sort?.column !== column) return { column, direction: "asc" };
	if (view.sort.direction === "asc") return { column, direction: "desc" };
	return null;
}

function compare(a: ClientSummary, b: ClientSummary, column: ClientColumn): number {
	switch (column) {
		case "name":
			return collator.compare(a.name, b.name);
		case "status":
			return collator.compare(a.status?.label ?? "", b.status?.label ?? "");
		case "city":
			return collator.compare(a.city ?? "", b.city ?? "");
		case "projects":
			return a.openProjectCount - b.openProjectCount || a.projectCount - b.projectCount;
	}
}

export function applyView(rows: ClientSummary[], view: ClientView): ClientSummary[] {
	const kept = rows.filter((row) => {
		if (view.statuses.length > 0 && !view.statuses.includes(row.status?.id ?? NO_STATUS)) return false;
		if (view.cities.length > 0 && !view.cities.includes(row.city ?? NO_CITY)) return false;
		return inRange(row.openProjectCount, view.openProjects) && inRange(row.projectCount, view.totalProjects);
	});
	if (!view.sort) return kept;
	const { column, direction } = view.sort;
	const sign = direction === "asc" ? 1 : -1;
	// Array.sort is stable, so rows that tie keep the order the service gave them.
	return [...kept].sort((a, b) => sign * compare(a, b, column));
}

/** Distinct cities in the rows, alphabetical, without the empty one. */
export function citiesOf(rows: ClientSummary[]): string[] {
	const seen = new Set<string>();
	for (const row of rows) if (row.city) seen.add(row.city);
	return [...seen].sort(collator.compare);
}

/** Distinct statuses in the rows, alphabetical by label. */
export function statusesOf(rows: ClientSummary[]): { id: string; label: string }[] {
	const seen = new Map<string, string>();
	for (const row of rows) if (row.status) seen.set(row.status.id, row.status.label);
	return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => collator.compare(a.label, b.label));
}
