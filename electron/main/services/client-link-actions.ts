/**
 * Opening a client's link in the default browser. Apart from client-links.ts so
 * that file stays testable in plain Node. The address is resolved from the id
 * and checked again here, so a renderer never chooses what the system opens.
 */
import { shell } from "electron";
import { getDb, type Db } from "../db";
import * as clientLinks from "./client-links";

export async function open(id: string, db: Db = getDb()): Promise<void> {
	const link = await clientLinks.get(id, db);
	const url = new URL(link.url);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Only http and https links are opened from Juno.");
	}
	await shell.openExternal(url.href);
}
