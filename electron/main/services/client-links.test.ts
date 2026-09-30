/**
 * Runs under plain Node through Vitest, not inside Electron. See the header
 * comment in clients.test.ts for why.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { guessClientLinkKind } from "../../shared/client-links";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import * as clientLinks from "./client-links";
import * as clients from "./clients";
import { clientLinkTools } from "../mcp/client-links";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function freshDb(): Db {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	return createDrizzle(connection);
}

describe("client links", () => {
	it("adds https to a bare address and guesses the kind from the host", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Hyge" }, db);

		const site = await clientLinks.create({ clientId: client.id, url: "hyge.be" }, db);
		expect(site).toMatchObject({ url: "https://hyge.be/", kind: "website", label: null });

		const profile = await clientLinks.create(
			{ clientId: client.id, url: "https://www.linkedin.com/company/hyge", label: "  Company page " },
			db,
		);
		expect(profile).toMatchObject({ kind: "linkedin", label: "Company page" });
	});

	it("refuses addresses that are not web addresses", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Hyge" }, db);
		for (const url of ["", "javascript:alert(1)", "file:///C:/secret.txt", "mailto:a@b.be", "notanaddress"]) {
			await expect(clientLinks.create({ clientId: client.id, url }, db)).rejects.toThrow();
		}
		await expect(clientLinks.create({ clientId: client.id, url: "hyge.be", kind: "myspace" }, db)).rejects.toThrow(
			/kind must be one of/,
		);
	});

	it("lists oldest first, hides removed links and brings them back", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Hyge" }, db);
		const first = await clientLinks.create({ clientId: client.id, url: "hyge.be" }, db);
		const second = await clientLinks.create({ clientId: client.id, url: "instagram.com/hyge" }, db);
		expect((await clientLinks.listForClient(client.id, db)).map((link) => link.id)).toEqual([first.id, second.id]);

		await clientLinks.remove(first.id, db);
		expect((await clientLinks.listForClient(client.id, db)).map((link) => link.id)).toEqual([second.id]);
		await expect(clientLinks.remove(first.id, db)).rejects.toThrow(/already be deleted/);

		await clientLinks.restore(first.id, db);
		expect(await clientLinks.listForClient(client.id, db)).toHaveLength(2);
	});

	it("updates only the fields given and validates a new address", async () => {
		const db = freshDb();
		const client = await clients.create({ name: "Hyge" }, db);
		const link = await clientLinks.create({ clientId: client.id, url: "hyge.be", label: "Shop" }, db);

		const renamed = await clientLinks.update(link.id, { label: null }, db);
		expect(renamed).toMatchObject({ label: null, url: "https://hyge.be/" });
		await expect(clientLinks.update(link.id, { url: "javascript:alert(1)" }, db)).rejects.toThrow();
	});

	it("refuses a link for a client that does not exist", async () => {
		const db = freshDb();
		await expect(clientLinks.create({ clientId: "missing", url: "hyge.be" }, db)).rejects.toThrow(/No client/);
	});

	it("recognises common hosts", () => {
		expect(guessClientLinkKind("https://twitter.com/x")).toBe("x");
		expect(guessClientLinkKind("https://nl.linkedin.com/in/a")).toBe("linkedin");
		expect(guessClientLinkKind("https://example.be")).toBe("website");
	});

	it("is offered to the agent, with the writes asking for confirmation", () => {
		const byName = new Map(clientLinkTools.map((tool) => [tool.name, tool]));
		expect(byName.get("clients.links.list_for_client")?.readOnly).toBe(true);
		for (const name of ["create", "update", "delete", "restore"]) {
			expect(byName.get(`clients.links.${name}`)?.requiresConfirmation).toBe(true);
		}
	});
});
