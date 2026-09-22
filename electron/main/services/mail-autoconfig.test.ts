import { describe, expect, it } from "vitest";
import { domainOf, guess, resolveByMx } from "./mail-autoconfig";

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

describe("mail autoconfig by MX", () => {
	const ovh = async () => [
		{ exchange: "mx1.mail.ovh.net", priority: 1 },
		{ exchange: "mx2.mail.ovh.net", priority: 5 },
	];

	/**
	 * The case that made this exist. A business has its own domain, the domain
	 * says nothing about who runs its mail, and imap.<domain> does not answer.
	 * The MX host names the provider.
	 */
	it("finds the host behind a business domain", async () => {
		expect(await resolveByMx("info@digistra.be", ovh)).toMatchObject({
			source: "mx",
			domain: "digistra.be",
			imapHost: "imap.mail.ovh.net",
			imapPort: 993,
			smtpHost: "smtp.mail.ovh.net",
			smtpPort: 465,
			username: "info@digistra.be",
		});
	});

	it("reads the primary record first", async () => {
		const mixed = async () => [
			{ exchange: "backup.unknown-host.example", priority: 50 },
			{ exchange: "mx1.mail.ovh.net", priority: 1 },
		];
		expect(await resolveByMx("info@example.be", mixed)).toMatchObject({
			imapHost: "imap.mail.ovh.net",
		});
	});

	it("matches on a dot boundary, so a lookalike domain does not count", async () => {
		const lookalike = async () => [{ exchange: "mx.notovh.net", priority: 1 }];
		expect(await resolveByMx("info@example.be", lookalike)).toBeNull();
	});

	/**
	 * Null is an answer, not a failure: it means the convention guess is still
	 * the best available, which is worth saying differently from "DNS broke".
	 */
	it("returns null for a host it does not recognise", async () => {
		const unknown = async () => [{ exchange: "mail.some-small-host.be", priority: 10 }];
		expect(await resolveByMx("info@example.be", unknown)).toBeNull();
	});

	it("says what to do when the lookup itself fails", async () => {
		const broken = async () => {
			throw new Error("ENOTFOUND");
		};
		await expect(resolveByMx("info@example.be", broken)).rejects.toThrow(/by hand/);
	});

	it("carries the app-password warning through an MX match", async () => {
		const google = async () => [{ exchange: "aspmx.l.google.com", priority: 1 }];
		expect((await resolveByMx("info@example.be", google))?.note).toContain("app password");
	});
});
