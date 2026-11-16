import { describe, expect, it } from "vitest";
import { createClickGate } from "./click-timing";

/** A clock the test moves by hand. */
function fakeTimer() {
	let now = 0;
	let next = 1;
	const waiting = new Map<number, { at: number; run: () => void }>();
	return {
		timer: {
			set: (run: () => void, ms: number) => {
				const handle = next++;
				waiting.set(handle, { at: now + ms, run });
				return handle;
			},
			clear: (handle: number) => {
				waiting.delete(handle);
			},
		},
		advance(ms: number) {
			now += ms;
			for (const [handle, entry] of [...waiting]) {
				if (entry.at <= now) {
					waiting.delete(handle);
					entry.run();
				}
			}
		},
	};
}

function gateWithLog() {
	const clock = fakeTimer();
	const log: string[] = [];
	const gate = createClickGate<string>(
		{ single: (id) => log.push(`single ${id}`), double: (id) => log.push(`double ${id}`) },
		{ delay: 250, timer: clock.timer },
	);
	return { gate, log, clock };
}

describe("createClickGate", () => {
	it("holds a single click for the delay, then runs it", () => {
		const { gate, log, clock } = gateWithLog();
		gate.click("a", 1);
		clock.advance(200);
		expect(log).toEqual([]);
		clock.advance(60);
		expect(log).toEqual(["single a"]);
	});

	it("runs only the double click when a second click comes in time", () => {
		const { gate, log, clock } = gateWithLog();
		gate.click("a", 1);
		clock.advance(120);
		gate.click("a", 2);
		clock.advance(500);
		expect(log).toEqual(["double a"]);
	});

	it("takes the platform's own count as a double click even after the delay", () => {
		const { gate, log, clock } = gateWithLog();
		gate.click("a", 1);
		clock.advance(300);
		gate.click("a", 2);
		expect(log).toEqual(["single a", "double a"]);
	});

	it("lets a held click go when another target is clicked", () => {
		const { gate, log, clock } = gateWithLog();
		gate.click("a", 1);
		clock.advance(100);
		gate.click("b", 1);
		clock.advance(300);
		expect(log).toEqual(["single b"]);
	});

	it("forgets a held click when cancelled", () => {
		const { gate, log, clock } = gateWithLog();
		gate.click("a", 1);
		gate.cancel();
		clock.advance(500);
		expect(log).toEqual([]);
	});
});
