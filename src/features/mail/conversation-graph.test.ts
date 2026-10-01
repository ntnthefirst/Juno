import { describe, expect, it } from "vitest";
import { layoutConversation } from "./conversation-graph";

const node = (id: string, inReplyTo: string | null = null) => ({ id, messageId: `<${id}>`, inReplyTo });

describe("layoutConversation", () => {
	it("keeps a plain back and forth on one line", () => {
		const graph = layoutConversation([node("a"), node("b", "<a>"), node("c", "<b>")]);
		expect(graph.lanes).toBe(1);
		expect(graph.rows.map((row) => [row.lane, row.parent])).toEqual([
			[0, null],
			[0, 0],
			[0, 1],
		]);
	});

	it("opens a branch for a second answer to the same message", () => {
		const graph = layoutConversation([node("a"), node("b", "<a>"), node("c", "<a>"), node("d", "<b>")]);
		expect(graph.lanes).toBe(2);
		expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
		expect(graph.rows[2]!.parent).toBe(0);
		expect(graph.rows[3]!.parent).toBe(1);
	});

	it("carries on along a branch", () => {
		const graph = layoutConversation([node("a"), node("b", "<a>"), node("c", "<a>"), node("d", "<c>")]);
		expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 1, 1]);
	});

	it("hangs a message with an unknown parent from the one before it", () => {
		const graph = layoutConversation([node("a"), { id: "b", messageId: null, inReplyTo: "<elsewhere>" }]);
		expect(graph.rows[1]).toMatchObject({ lane: 0, parent: 0 });
	});
});
