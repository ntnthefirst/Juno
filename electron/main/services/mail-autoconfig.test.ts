import { describe, expect, it } from "vitest";
import { MAIL_PROVIDERS, providerOfAccount } from "../../shared/mail-providers";
import type { MailProviderId } from "../../shared/types";
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

/**
 * Every tile on the Add account screen, against the servers its provider
 * publishes. A tile that guesses wrong is worse than no tile: the person did
 * everything right and the test fails anyway. The values are the ones checked
 * against each provider's help pages; see shared/mail-providers.ts.
 */
describe("the provider tiles", () => {
	const published: Record<string, [string, number, string, string, number, string, string]> = {
		gmail: ["imap.gmail.com", 993, "tls", "smtp.gmail.com", 465, "tls", "app-password"],
		outlook: ["outlook.office365.com", 993, "tls", "smtp-mail.outlook.com", 587, "starttls", "microsoft"],
		m365: ["outlook.office365.com", 993, "tls", "smtp.office365.com", 587, "starttls", "microsoft"],
		icloud: ["imap.mail.me.com", 993, "tls", "smtp.mail.me.com", 587, "starttls", "app-password"],
		ovh: ["imap.mail.ovh.net", 993, "tls", "smtp.mail.ovh.net", 465, "tls", "password"],
		proximus: ["imap.proximus.be", 993, "tls", "relay.proximus.be", 587, "starttls", "password"],
		telenet: ["imap.telenet.be", 993, "tls", "smtp.telenet.be", 587, "starttls", "password"],
		yahoo: ["imap.mail.yahoo.com", 993, "tls", "smtp.mail.yahoo.com", 465, "tls", "app-password"],
		combell: ["imap.mailprotect.be", 993, "tls", "smtp-auth.mailprotect.be", 465, "tls", "password"],
	};

	it("draws nine tiles, in the frame's order", () => {
		expect(MAIL_PROVIDERS.map((provider) => provider.id)).toEqual(Object.keys(published));
	});

	for (const [id, [imapHost, imapPort, imapSecurity, smtpHost, smtpPort, smtpSecurity, signIn]] of Object.entries(published)) {
		it(`uses ${id}'s published servers whatever the domain, once its tile is picked`, () => {
			expect(guess("info@vandamme.be", id as MailProviderId)).toMatchObject({
				source: "known",
				provider: id,
				imapHost,
				imapPort,
				imapSecurity,
				smtpHost,
				smtpPort,
				smtpSecurity,
				signIn,
			});
		});
	}

	it("gives every app-password provider a guide and an https page to open", () => {
		for (const provider of MAIL_PROVIDERS.filter((entry) => entry.signIn === "app-password")) {
			expect(provider.appPassword?.steps.length).toBeGreaterThan(0);
			expect(new URL(provider.appPassword!.url).protocol).toBe("https:");
		}
		for (const provider of MAIL_PROVIDERS.filter((entry) => entry.signIn !== "app-password")) {
			expect(provider.appPassword).toBeUndefined();
		}
	});

	it("recognises an address at a provider's own domain without being told", () => {
		expect(guess("jan@hotmail.be")).toMatchObject({ provider: "outlook", signIn: "microsoft" });
		expect(guess("jan@skynet.be")).toMatchObject({ provider: "proximus", smtpHost: "relay.proximus.be" });
		expect(guess("jan@yahoo.com")).toMatchObject({ provider: "yahoo", providerName: "Yahoo" });
	});

	it("signs in to iCloud with the name for IMAP and the whole address for SMTP", () => {
		expect(guess("jan.peeters@icloud.com")).toMatchObject({
			username: "jan.peeters",
			smtpUsername: "jan.peeters@icloud.com",
		});
		expect(guess("jan@gmail.com").smtpUsername).toBeNull();
	});

	it("refuses a provider it does not have", () => {
		expect(() => guess("a@b.be", "aol" as MailProviderId)).toThrow(/does not know/);
	});

	it("leaves an unknown domain with the convention and the password route", () => {
		expect(guess("info@vandamme.be")).toMatchObject({ source: "convention", provider: null, signIn: "password" });
	});

	it("names the provider behind an own domain from its MX", async () => {
		const combell = async () => [{ exchange: "mx.mailprotect.be", priority: 10 }];
		expect(await resolveByMx("info@vandamme.be", combell)).toMatchObject({
			source: "mx",
			provider: "combell",
			providerName: "Combell",
			smtpHost: "smtp-auth.mailprotect.be",
		});
		const office = async () => [{ exchange: "vandamme-be.mail.protection.outlook.com", priority: 0 }];
		expect(await resolveByMx("info@vandamme.be", office)).toMatchObject({ provider: "m365", signIn: "microsoft" });
		const transip = async () => [{ exchange: "mx.transip.email", priority: 0 }];
		expect(await resolveByMx("info@vandamme.be", transip)).toMatchObject({ provider: null, providerName: "TransIP" });
	});

	it("matches an account row to its tile by the servers it uses", () => {
		expect(providerOfAccount({ email: "a@vandamme.be", imapHost: "imap.mail.ovh.net", smtpHost: "smtp.mail.ovh.net" })?.id).toBe("ovh");
		expect(providerOfAccount({ email: "a@hotmail.com", imapHost: "outlook.office365.com", smtpHost: "smtp-mail.outlook.com" })?.id).toBe("outlook");
		expect(providerOfAccount({ email: "a@vandamme.be", imapHost: "outlook.office365.com", smtpHost: "smtp.office365.com" })?.id).toBe("m365");
		expect(providerOfAccount({ email: "a@vandamme.be", imapHost: "imap.vandamme.be", smtpHost: null })).toBeNull();
	});
});
