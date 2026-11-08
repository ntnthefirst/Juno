import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { clientEmails, clientLinks } from "../db/schema";
import * as addresses from "./client-addresses";
import * as emails from "./client-emails";
import { createWithContact } from "./client-intake";
import * as links from "./client-links";
import * as phones from "./client-phones";
import * as clients from "./clients";
import * as contacts from "./contacts";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("createWithContact", () => {
	it("makes the client and its primary email, phone and address together", async () => {
		const db = freshDb();
		const client = await createWithContact(
			{ name: "Peeters", email: "tom@peeters.test", phone: "+32 470 98 76 54", address: "Kerkstraat 1, 9000 Gent" },
			db,
		);

		const [email] = await emails.listForClient(client.id, db);
		const [phone] = await phones.listForClient(client.id, db);
		const [address] = await addresses.listForClient(client.id, db);
		expect(email).toMatchObject({ email: "tom@peeters.test", isPrimary: true });
		expect(phone).toMatchObject({ phone: "+32 470 98 76 54", isPrimary: true });
		expect(address).toMatchObject({ addressLine1: "Kerkstraat 1, 9000 Gent", isPrimary: true });
	});

	it("leaves out the details that were left empty", async () => {
		const db = freshDb();
		const client = await createWithContact({ name: "Janssens", email: "  ", phone: null }, db);
		expect(await emails.listForClient(client.id, db)).toHaveLength(0);
		expect(await phones.listForClient(client.id, db)).toHaveLength(0);
	});

	it("saves nothing when the client itself is refused", async () => {
		const db = freshDb();
		await expect(createWithContact({ name: "  ", email: "a@b.test" }, db)).rejects.toThrow();
		expect(await clients.list(undefined, db)).toHaveLength(0);
	});

	it("makes every kind of detail in one call, the first of each primary", async () => {
		const db = freshDb();
		const client = await createWithContact(
			{
				name: "Hyge",
				emails: [{ email: "info@hyge.test", label: "Algemeen" }, { email: "fact@hyge.test", label: "Facturatie" }],
				phones: [{ phone: "+32 470 12 34 56" }, { phone: "+32 9 123 45 67", label: "Kantoor" }],
				addresses: [{ addressLine1: "Kerkstraat 1", postalCode: "9000", city: "Gent", country: "BE" }],
				links: [{ url: "hyge.be" }, { url: "https://www.linkedin.com/company/hyge", label: "Company page" }],
				contacts: [{ name: "An Peeters", role: "Zaakvoerder", email: "an@hyge.test", isPrimary: true }, { name: "Tom Janssens" }],
			},
			db,
		);

		const mails = await emails.listForClient(client.id, db);
		expect(mails.map((row) => [row.email, row.isPrimary])).toEqual([
			["info@hyge.test", true],
			["fact@hyge.test", false],
		]);
		expect(mails.find((row) => row.email === "fact@hyge.test")?.label).toBe("Facturatie");
		expect((await phones.listForClient(client.id, db)).filter((row) => row.isPrimary)).toHaveLength(1);
		expect(await addresses.listForClient(client.id, db)).toEqual([
			expect.objectContaining({ addressLine1: "Kerkstraat 1", city: "Gent", postalCode: "9000", isPrimary: true }),
		]);
		const found = await links.listForClient(client.id, db);
		expect(found).toHaveLength(2);
		expect(found.map((row) => row.kind)).toContain("linkedin");
		const people = await contacts.listForClient(client.id, db);
		expect(people.map((row) => [row.name, row.isPrimary])).toEqual([
			["An Peeters", true],
			["Tom Janssens", false],
		]);
	});

	it("honours an explicit primary that is not the first entry", async () => {
		const db = freshDb();
		const client = await createWithContact(
			{ name: "Hyge", emails: [{ email: "a@hyge.test" }, { email: "b@hyge.test", isPrimary: true }] },
			db,
		);
		const rows = await emails.listForClient(client.id, db);
		expect(rows.filter((row) => row.isPrimary).map((row) => row.email)).toEqual(["b@hyge.test"]);
	});

	it("refuses two primaries of one kind and saves nothing", async () => {
		const db = freshDb();
		await expect(
			createWithContact(
				{ name: "Hyge", phones: [{ phone: "+32 470 12 34 56", isPrimary: true }, { phone: "+32 9 123 45 67", isPrimary: true }] },
				db,
			),
		).rejects.toThrow(/"phones".*primary/);
		expect(await clients.list(undefined, db)).toHaveLength(0);
	});

	it("rolls the whole client back when one detail is invalid, and names it", async () => {
		const db = freshDb();
		await expect(
			createWithContact(
				{ name: "Hyge", emails: [{ email: "ok@hyge.test" }], links: [{ url: "https://hyge.be" }, { url: "not a web address" }] },
				db,
			),
		).rejects.toThrow(/^links\[1\]:/);
		expect(await clients.list(undefined, db)).toHaveLength(0);
		expect(db.select().from(clientEmails).all()).toHaveLength(0);
		expect(db.select().from(clientLinks).all()).toHaveLength(0);
	});

	it("refuses a single detail together with its list", async () => {
		const db = freshDb();
		await expect(
			createWithContact({ name: "Hyge", email: "a@hyge.test", emails: [{ email: "b@hyge.test" }] }, db),
		).rejects.toThrow(/either "email" or "emails"/);
		expect(await clients.list(undefined, db)).toHaveLength(0);
	});
});
