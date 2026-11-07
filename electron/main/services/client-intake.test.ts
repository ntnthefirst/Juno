import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as addresses from "./client-addresses";
import * as emails from "./client-emails";
import { createWithContact } from "./client-intake";
import * as phones from "./client-phones";
import * as clients from "./clients";

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
});
