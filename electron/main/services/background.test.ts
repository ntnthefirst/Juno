import { describe, expect, it } from "vitest";
import { shouldRunInBackground, startsWithoutWindow } from "./background";

const on = { packaged: true, smoke: false, serverEnabled: true, background: true, setupDone: true };

describe("shouldRunInBackground", () => {
	it("is on for an installed copy that finished setup, with the server on", () => {
		expect(shouldRunInBackground(on)).toBe(true);
	});

	it("is off when any one of its conditions is not met", () => {
		expect(shouldRunInBackground({ ...on, background: false })).toBe(false);
		expect(shouldRunInBackground({ ...on, serverEnabled: false })).toBe(false);
		expect(shouldRunInBackground({ ...on, setupDone: false })).toBe(false);
		expect(shouldRunInBackground({ ...on, packaged: false })).toBe(false);
		expect(shouldRunInBackground({ ...on, smoke: true })).toBe(false);
	});
});

describe("startsWithoutWindow", () => {
	it("skips the window only for a start at login, and only while it runs in the background", () => {
		expect(startsWithoutWindow({ argv: ["juno.exe", "--background"], openedAsHidden: false, background: true })).toBe(true);
		expect(startsWithoutWindow({ argv: ["juno.exe"], openedAsHidden: true, background: true })).toBe(true);
		expect(startsWithoutWindow({ argv: ["juno.exe"], openedAsHidden: false, background: true })).toBe(false);
		expect(startsWithoutWindow({ argv: ["juno.exe", "--background"], openedAsHidden: false, background: false })).toBe(false);
	});
});
