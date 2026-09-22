import { describe, expect, it } from "vitest";
import { domainOf, guess } from "./mail-autoconfig";

describe("mail autoconfig", () => {
	it("knows the providers a Belgian business is likely to be on", () => {
		expect(guess("hallo@telenet.be")).toMatchObject({
			source: "known",
			imapHost: "imap.telenet.be",
			smtpHost: "smtp.telenet.be",
			smtpPort: 587,
			smtpSecurity: "starttls",
		});
	});

	it("falls back to the convention for a domain it has not heard of", () => {
		const result = guess("info@vandenbergh-dakwerken.be");
		expect(result.source).toBe("convention");
		expect(result.imapHost).toBe("imap.vandenbergh-dakwerken.be");
		expect(result.smtpHost).toBe("smtp.vandenbergh-dakwerken.be");
	});

	/**
	 * A guess that is silently wrong about the password is worse than no guess:
	 * the person types the right password, the test fails, and nothing says why.
	 */
	it("says when the provider will reject the account password", () => {
		expect(guess("someone@gmail.com").note).toContain("app password");
		expect(guess("someone@example.be").note).toBeNull();
	});

	it("uses the whole address as the username, which is what nearly all of them want", () => {
		expect(guess("Hallo@Example.BE ").username).toBe("Hallo@Example.BE");
	});

	it("is case and whitespace insensitive about the domain", () => {
		expect(domainOf("  Hallo@TELENET.be ")).toBe("telenet.be");
		expect(guess(" hallo@TELENET.be ").imapHost).toBe("imap.telenet.be");
	});

	it("refuses an address it cannot split", () => {
		expect(() => guess("not-an-address")).toThrow(/full email address/);
		expect(() => guess("two@at@signs.be")).toThrow(/full email address/);
	});
});
