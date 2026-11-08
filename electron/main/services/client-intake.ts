/**
 * A client made together with the contact details typed in the same form.
 *
 * Kept apart from `clients.ts` because the detail tables import that file.
 * Everything is one transaction, so a bad email cannot leave a client behind
 * without the address that came with it.
 *
 * Two ways in. The form sends one `email`, `phone` and `address`, each of which
 * becomes the primary row of its kind. An agent can send `emails`, `phones`,
 * `addresses`, `links` and `contacts` instead, with everything those records
 * carry. Sending both forms for one kind is refused rather than merged.
 */
import type { Client, ClientIntakeInput } from "../../shared/types";
import { getDb, type Db } from "../db";
import { insertAddress } from "./client-addresses";
import { insertEmail } from "./client-emails";
import { insertLink } from "./client-links";
import { insertPhone } from "./client-phones";
import { insertClient } from "./clients";
import { insertContact } from "./contacts";

function textOrNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

type Entry = { isPrimary?: boolean };

function refuseBoth(single: string | null, list: unknown[] | undefined, singular: string, plural: string): void {
	if (single && list && list.length > 0) {
		throw new Error(`Give either "${singular}" or "${plural}", not both. Put every ${singular} in "${plural}".`);
	}
}

function refuseTwoPrimaries(list: Entry[] | undefined, field: string): void {
	const primaries = (list ?? []).filter((entry) => entry.isPrimary === true).length;
	if (primaries > 1) {
		throw new Error(`Only one entry in "${field}" can be primary, but ${primaries} are. Mark one and leave the others out.`);
	}
}

/** Runs one child insert and says which entry was wrong, so a caller can fix just that one. */
function insertEach<T>(list: T[] | undefined, field: string, insert: (entry: T) => unknown): void {
	(list ?? []).forEach((entry, index) => {
		try {
			insert(entry);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${field}[${index}]: ${message}`);
		}
	});
}

export async function createWithContact(input: ClientIntakeInput, db: Db = getDb()): Promise<Client> {
	const { email, phone, address, emails, phones, addresses, links, contacts, ...fields } = input;
	const emailText = textOrNull(email);
	const phoneText = textOrNull(phone);
	const addressText = textOrNull(address);

	refuseBoth(emailText, emails, "email", "emails");
	refuseBoth(phoneText, phones, "phone", "phones");
	refuseBoth(addressText, addresses, "address", "addresses");
	refuseTwoPrimaries(emails, "emails");
	refuseTwoPrimaries(phones, "phones");
	refuseTwoPrimaries(addresses, "addresses");
	refuseTwoPrimaries(contacts, "contacts");

	return db.transaction((tx) => {
		const client = insertClient(fields, tx);
		const clientId = client.id;
		// The first of each kind becomes the primary one, which is what the child
		// services do for the first row on a client. Contacts are the exception:
		// their service marks a primary only when asked.
		if (emailText) insertEmail({ clientId, email: emailText }, tx);
		if (phoneText) insertPhone({ clientId, phone: phoneText }, tx);
		if (addressText) insertAddress({ clientId, addressLine1: addressText }, tx);
		insertEach(emails, "emails", (entry) => insertEmail({ ...entry, clientId }, tx));
		insertEach(phones, "phones", (entry) => insertPhone({ ...entry, clientId }, tx));
		insertEach(addresses, "addresses", (entry) => insertAddress({ ...entry, clientId }, tx));
		insertEach(links, "links", (entry) => insertLink({ ...entry, clientId }, tx));
		insertEach(contacts, "contacts", (entry) => insertContact({ ...entry, clientId }, tx));
		return client;
	});
}
