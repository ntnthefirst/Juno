/**
 * The settings store, pointed at a temp folder rather than a real userData
 * path. Two things are worth a test here and the rest is field copying: the
 * carry-forward from the shape that held one name, one address and one number,
 * and the invariant that the owner's two contact lists hold exactly one
 * primary no matter which way they were changed.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { configureSettings } from "./settings";
import * as settings from "./settings";

function freshStore(contents?: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "juno-settings-"));
	if (contents !== undefined) {
		writeFileSync(join(dir, "settings.json"), JSON.stringify(contents), "utf8");
	}
	configureSettings(dir);
	return dir;
}

describe("the owner profile", () => {
	beforeEach(() => {
		freshStore();
	});

	it("starts empty, with no addresses and no numbers", async () => {
		const owner = await settings.getOwner();
		expect(owner.firstName).toBe("");
		expect(owner.establishmentNumber).toBe("");
		expect(owner.emails).toEqual([]);
		expect(owner.phones).toEqual([]);
	});

	it("keeps the scalar fields a patch carries and leaves the rest alone", async () => {
		await settings.setOwner({ firstName: "Nathan", lastName: "Peeters" });
		const owner = await settings.setOwner({ vatNumber: "BE0123456789" });
		expect(owner.firstName).toBe("Nathan");
		expect(owner.vatNumber).toBe("BE0123456789");
	});

	it("makes the first address primary without being asked", async () => {
		const owner = await settings.addOwnerEmail({ email: "hallo@juno.test" });
		expect(owner.emails).toHaveLength(1);
		expect(owner.emails[0].isPrimary).toBe(true);
	});

	it("moves the primary rather than having two", async () => {
		await settings.addOwnerEmail({ email: "first@juno.test" });
		const two = await settings.addOwnerEmail({ email: "second@juno.test", isPrimary: true });
		expect(two.emails.filter((entry) => entry.isPrimary)).toHaveLength(1);
		expect(two.emails.find((entry) => entry.isPrimary)?.email).toBe("second@juno.test");
	});

	it("records an address nobody reads, because that is the point of a list", async () => {
		const owner = await settings.addOwnerEmail({
			email: "old@vorigedomein.be",
			label: "old domain, forwards nowhere",
		});
		expect(owner.emails[0].label).toBe("old domain, forwards nowhere");
	});

	it("does not add the same address twice, and does not move the primary to it", async () => {
		await settings.addOwnerEmail({ email: "hallo@juno.test" });
		await settings.addOwnerEmail({ email: "tweede@juno.test", isPrimary: true });
		const owner = await settings.addOwnerEmail({ email: "HALLO@juno.test", label: "Mail account" });
		expect(owner.emails).toHaveLength(2);
		expect(owner.emails.find((entry) => entry.email === "hallo@juno.test")?.label).toBe("Mail account");
		expect(owner.emails.find((entry) => entry.isPrimary)?.email).toBe("tweede@juno.test");
	});

	it("promotes another address when the primary is removed", async () => {
		const first = await settings.addOwnerEmail({ email: "first@juno.test" });
		await settings.addOwnerEmail({ email: "second@juno.test" });
		const owner = await settings.removeOwnerEmail(first.emails[0].id);
		expect(owner.emails).toHaveLength(1);
		expect(owner.emails[0].isPrimary).toBe(true);
	});

	it("refuses an empty address, and says which field", async () => {
		await expect(settings.addOwnerEmail({ email: "   " })).rejects.toThrow(/cannot be empty/);
	});

	it("says so when an id is not on the list", async () => {
		await expect(settings.removeOwnerPhone("nope")).rejects.toThrow(/No phone number with id/);
	});

	it("keeps phone numbers under the same rules", async () => {
		await settings.addOwnerPhone({ phone: "+32 470 00 00 00", label: "gsm" });
		const owner = await settings.addOwnerPhone({ phone: "09 233 00 00", isPrimary: true });
		expect(owner.phones).toHaveLength(2);
		expect(owner.phones.find((entry) => entry.isPrimary)?.phone).toBe("09 233 00 00");
	});

	it("does not let a scalar patch clear the two lists", async () => {
		await settings.addOwnerEmail({ email: "hallo@juno.test" });
		const owner = await settings.setOwner({ businessName: "Juno" });
		expect(owner.emails).toHaveLength(1);
	});
});

describe("a settings file from the older shape", () => {
	it("splits the single contact name, and keeps the one address and number", async () => {
		freshStore({
			owner: {
				businessName: "Juno",
				contactName: "Nathan Van Peeters",
				email: "hallo@juno.test",
				phone: "+32 470 00 00 00",
			},
		});

		const owner = await settings.getOwner();
		expect(owner.firstName).toBe("Nathan");
		expect(owner.lastName).toBe("Van Peeters");
		expect(owner.emails).toHaveLength(1);
		expect(owner.emails[0]).toMatchObject({ email: "hallo@juno.test", isPrimary: true });
		expect(owner.phones[0]).toMatchObject({ phone: "+32 470 00 00 00", isPrimary: true });
	});

	it("settles a file that somehow holds two primaries", async () => {
		freshStore({
			owner: {
				emails: [
					{ id: "a", email: "a@juno.test", isPrimary: true },
					{ id: "b", email: "b@juno.test", isPrimary: true },
				],
			},
		});

		const owner = await settings.getOwner();
		expect(owner.emails.filter((entry) => entry.isPrimary)).toHaveLength(1);
		expect(owner.emails[0].isPrimary).toBe(true);
	});

	it("drops an entry with no address at all", async () => {
		freshStore({ owner: { emails: [{ id: "a", email: "  " }, { id: "b", email: "b@juno.test" }] } });
		const owner = await settings.getOwner();
		expect(owner.emails).toHaveLength(1);
		expect(owner.emails[0].email).toBe("b@juno.test");
	});
});
