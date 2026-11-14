import { describe, expect, it } from "vitest";
import type { ClientSummary, ProjectSummary } from "@shared/types";
import { placeKeyOf, placeOptions } from "./place-options";

const client = (id: string, name: string) => ({ id, name }) as ClientSummary;
const project = (id: string, name: string, clientId: string | null) => ({ id, name, clientId }) as ProjectSummary;

describe("placeOptions", () => {
	it("lists each client by name with its projects under it, then the projects of your own", () => {
		const options = placeOptions(
			[client("c2", "Zeno"), client("c1", "Atelier")],
			[project("p1", "Website", "c1"), project("p2", "Logo", "c1"), project("p3", "Own work", null), project("p4", "Brochure", "c2")],
		);
		expect(options.map((option) => [option.key, option.depth])).toEqual([
			["client:c1", 0],
			["project:p2", 1],
			["project:p1", 1],
			["client:c2", 0],
			["project:p4", 1],
			["project:p3", 0],
		]);
		expect(options[1]).toMatchObject({ clientId: "c1", projectId: "p2", clientName: "Atelier" });
	});

	it("keeps a project whose client is gone, at the top level", () => {
		const options = placeOptions([], [project("p1", "Orphan", "gone")]);
		expect(options).toEqual([
			{ key: "project:p1", kind: "project", name: "Orphan", depth: 0, clientId: null, projectId: "p1", clientName: null },
		]);
	});
});

describe("placeKeyOf", () => {
	it("names the project before the client, and nothing for a document kept under neither", () => {
		expect(placeKeyOf({ clientId: "c1", projectId: "p1" })).toBe("project:p1");
		expect(placeKeyOf({ clientId: "c1", projectId: null })).toBe("client:c1");
		expect(placeKeyOf({ clientId: null, projectId: null })).toBeNull();
	});
});
