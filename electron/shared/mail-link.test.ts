import { describe, expect, it } from "vitest";
import { isHttpsLink, isShellLink } from "./mail-link";

describe("isHttpsLink", () => {
	it("accepts https and nothing else", () => {
		expect(isHttpsLink("https://www.hyge.be/najaar-2026")).toBe(true);
		expect(isHttpsLink("HTTPS://hyge.be")).toBe(true);
		expect(isHttpsLink("http://hyge.be")).toBe(false);
		expect(isHttpsLink("mailto:a@b.be")).toBe(false);
		expect(isHttpsLink("javascript:alert(1)")).toBe(false);
		expect(isHttpsLink("file:///C:/Windows/system32/calc.exe")).toBe(false);
		expect(isHttpsLink("data:text/html,x")).toBe(false);
		expect(isHttpsLink("//hyge.be")).toBe(false);
		expect(isHttpsLink(" https://hyge.be")).toBe(false);
		expect(isHttpsLink("https://")).toBe(false);
	});
});

describe("isShellLink", () => {
	it("keeps the rule the main process already applied", () => {
		expect(isShellLink("https://hyge.be")).toBe(true);
		expect(isShellLink("http://hyge.be")).toBe(true);
		expect(isShellLink("mailto:a@b.be")).toBe(true);
		expect(isShellLink("file:///x")).toBe(false);
		expect(isShellLink("ms-msdt:/id")).toBe(false);
		expect(isShellLink("javascript:alert(1)")).toBe(false);
	});
});
