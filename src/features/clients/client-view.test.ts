import type { ClientSummary } from "@shared/types";
import { describe, expect, it } from "vitest";
import { applyView, EMPTY_VIEW, filterActive, nextSort, type ClientView } from "./client-view";

function row(name: string, extra: Partial<ClientSummary> = {}): ClientSummary {
	return { id: name, name, status: null, city: null, email: null, projectCount: 0, openProjectCount: 0, lastActivityAt: "2026-01-01T00:00:00.000Z", ...extra };
}

const lead = { id: "s1", label: "Lead", tone: null } as ClientSummary["status"];
const active = { id: "s2", label: "Active", tone: null } as ClientSummary["status"];

const rows = [
	row("Charlie", { status: lead, city: "Leuven", projectCount: 3, openProjectCount: 1 }),
	row("alpha", { status: active, city: "Gent", projectCount: 1, openProjectCount: 1 }),
	row("Bravo", { city: "Leuven", projectCount: 5, openProjectCount: 4 }),
];

const names = (list: ClientSummary[]) => list.map((entry) => entry.name);
const view = (patch: Partial<ClientView>): ClientView => ({ ...EMPTY_VIEW, ...patch });

describe("client view", () => {
	it("keeps the service order when nothing is set", () => {
		expect(names(applyView(rows, EMPTY_VIEW))).toEqual(["Charlie", "alpha", "Bravo"]);
	});

	it("sorts names ignoring case, both ways", () => {
		expect(names(applyView(rows, view({ sort: { column: "name", direction: "asc" } })))).toEqual([
			"alpha",
			"Bravo",
			"Charlie",
		]);
		expect(names(applyView(rows, view({ sort: { column: "name", direction: "desc" } })))).toEqual([
			"Charlie",
			"Bravo",
			"alpha",
		]);
	});

	it("sorts projects by open count, then total", () => {
		expect(names(applyView(rows, view({ sort: { column: "projects", direction: "desc" } })))).toEqual([
			"Bravo",
			"Charlie",
			"alpha",
		]);
	});

	it("filters by status, including clients with none", () => {
		expect(names(applyView(rows, view({ statuses: ["s1"] })))).toEqual(["Charlie"]);
		expect(names(applyView(rows, view({ statuses: ["s1", ""] })))).toEqual(["Charlie", "Bravo"]);
	});

	it("filters by city and by a range on each project count", () => {
		expect(names(applyView(rows, view({ cities: ["Leuven"] })))).toEqual(["Charlie", "Bravo"]);
		expect(names(applyView(rows, view({ openProjects: { min: 2, max: null } })))).toEqual(["Bravo"]);
		expect(names(applyView(rows, view({ totalProjects: { min: 1, max: 3 } })))).toEqual(["Charlie", "alpha"]);
	});

	it("reports which filter is on", () => {
		const v = view({ cities: ["Gent"] });
		expect(filterActive(v, "city")).toBe(true);
		expect(filterActive(v, "status")).toBe(false);
		expect(filterActive(view({ totalProjects: { min: null, max: 2 } }), "projects")).toBe(true);
	});

	it("steps a header click through ascending, descending and off", () => {
		const asc = nextSort(EMPTY_VIEW, "city");
		expect(asc).toEqual({ column: "city", direction: "asc" });
		const desc = nextSort(view({ sort: asc }), "city");
		expect(desc).toEqual({ column: "city", direction: "desc" });
		expect(nextSort(view({ sort: desc }), "city")).toBeNull();
		expect(nextSort(view({ sort: desc }), "name")).toEqual({ column: "name", direction: "asc" });
	});
});
