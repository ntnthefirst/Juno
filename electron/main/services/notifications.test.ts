import { describe, expect, it } from "vitest";
import { agentNotificationReason } from "./notifications";

const now = Date.parse("2026-09-23T12:00:00.000Z");

function pending(createdAt: string) {
	return [{ createdAt }];
}

describe("agent request notifications", () => {
	it("uses the count threshold without also needing the age threshold", () => {
		const requests = Array.from({ length: 10 }, () => ({ createdAt: new Date(now).toISOString() }));

		expect(agentNotificationReason(requests, now)).toBe("count");
	});

	it("uses the oldest request threshold when fewer than ten are waiting", () => {
		expect(agentNotificationReason(pending(new Date(now - 60_000).toISOString()), now)).toBe("age");
		expect(agentNotificationReason(pending(new Date(now - 59_999).toISOString()), now)).toBeNull();
	});
});
