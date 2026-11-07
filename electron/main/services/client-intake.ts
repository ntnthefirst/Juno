/**
 * A client made together with the contact details typed in the same form.
 *
 * Kept apart from `clients.ts` because the detail tables import that file.
 * Everything is one transaction, so a bad email cannot leave a client behind
 * without the address that came with it.
 */
import type { Client, ClientIntakeInput } from "../../shared/types";
import { getDb, type Db } from "../db";
import { insertAddress } from "./client-addresses";
import { insertEmail } from "./client-emails";
import { insertPhone } from "./client-phones";
import { insertClient } from "./clients";

function textOrNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

export async function createWithContact(input: ClientIntakeInput, db: Db = getDb()): Promise<Client> {
	const { email, phone, address, ...fields } = input;
	const emailText = textOrNull(email);
	const phoneText = textOrNull(phone);
	const addressText = textOrNull(address);

	return db.transaction((tx) => {
		const client = insertClient(fields, tx);
		// The first of each becomes the primary one, which is what the service does
		// for the first row on a client.
		if (emailText) insertEmail({ clientId: client.id, email: emailText }, tx);
		if (phoneText) insertPhone({ clientId: client.id, phone: phoneText }, tx);
		if (addressText) insertAddress({ clientId: client.id, addressLine1: addressText }, tx);
		return client;
	});
}
