import { describe, expect, it } from "vitest";
import { formatCombo, matchesCombo, type KeyLike } from "./shortcuts";

function press(init: Partial<KeyLike> & { key: string }): KeyLike {
	return { code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init };
}

describe("matchesCombo", () => {
	it("takes mod as Control off a Mac and Command on one", () => {
		const ctrlK = press({ key: "k", code: "KeyK", ctrlKey: true });
		const cmdK = press({ key: "k", code: "KeyK", metaKey: true });
		expect(matchesCombo(ctrlK, "mod+k", false)).toBe(true);
		expect(matchesCombo(cmdK, "mod+k", false)).toBe(false);
		expect(matchesCombo(cmdK, "mod+k", true)).toBe(true);
		expect(matchesCombo(ctrlK, "mod+k", true)).toBe(false);
	});

	it("does not fire without the modifier", () => {
		expect(matchesCombo(press({ key: "k", code: "KeyK" }), "mod+k", false)).toBe(false);
	});

	it("keeps Ctrl+L and Ctrl+Shift+L apart", () => {
		const plain = press({ key: "l", code: "KeyL", ctrlKey: true });
		const shifted = press({ key: "L", code: "KeyL", ctrlKey: true, shiftKey: true });
		expect(matchesCombo(plain, "mod+shift+l", false)).toBe(false);
		expect(matchesCombo(shifted, "mod+shift+l", false)).toBe(true);
		expect(matchesCombo(shifted, "mod+l", false)).toBe(false);
	});

	it("reads a digit from the physical key, so an AZERTY number row still works", () => {
		// On a Belgian layout the unshifted 3 key types a double quote.
		const azerty = press({ key: '"', code: "Digit3", ctrlKey: true });
		expect(matchesCombo(azerty, "mod+3", false)).toBe(true);
		expect(matchesCombo(azerty, "mod+4", false)).toBe(false);
	});

	it("accepts the number pad as well", () => {
		expect(matchesCombo(press({ key: "5", code: "Numpad5", ctrlKey: true }), "mod+5", false)).toBe(true);
	});

	it("ignores Shift for punctuation, because it sits on different keys on different layouts", () => {
		expect(matchesCombo(press({ key: "?", shiftKey: true }), "?", false)).toBe(true);
		expect(matchesCombo(press({ key: "?" }), "?", false)).toBe(true);
		expect(matchesCombo(press({ key: "/", ctrlKey: true, shiftKey: true }), "mod+/", false)).toBe(true);
		expect(matchesCombo(press({ key: ",", ctrlKey: true }), "mod+,", false)).toBe(true);
	});

	it("does not let a bare key fire while a modifier is held", () => {
		expect(matchesCombo(press({ key: "?", ctrlKey: true }), "?", false)).toBe(false);
	});

	it("rejects Alt unless the shortcut asks for it", () => {
		expect(matchesCombo(press({ key: "k", ctrlKey: true, altKey: true }), "mod+k", false)).toBe(false);
		expect(matchesCombo(press({ key: "ArrowLeft", altKey: true }), "alt+arrowleft", false)).toBe(true);
	});

	it("matches named keys whatever their case", () => {
		expect(matchesCombo(press({ key: "ArrowLeft", altKey: true }), "alt+arrowleft", false)).toBe(true);
		expect(matchesCombo(press({ key: "ArrowRight", altKey: true }), "alt+arrowleft", false)).toBe(false);
	});

	it("treats the Windows key as a stray modifier off a Mac", () => {
		expect(matchesCombo(press({ key: "k", ctrlKey: true, metaKey: true }), "mod+k", false)).toBe(false);
	});
});

describe("formatCombo", () => {
	it("draws Control and Shift off a Mac", () => {
		expect(formatCombo("mod+shift+l", false)).toEqual(["Ctrl", "Shift", "L"]);
	});

	it("draws the Mac symbols on one", () => {
		expect(formatCombo("mod+shift+l", true)).toEqual(["⌘", "⇧", "L"]);
	});

	it("names arrows and the escape key", () => {
		expect(formatCombo("alt+arrowleft", false)).toEqual(["Alt", "←"]);
		expect(formatCombo("escape", false)).toEqual(["Esc"]);
	});

	it("draws a lone character as itself", () => {
		expect(formatCombo("?", false)).toEqual(["?"]);
		expect(formatCombo("mod+,", false)).toEqual(["Ctrl", ","]);
	});
});
