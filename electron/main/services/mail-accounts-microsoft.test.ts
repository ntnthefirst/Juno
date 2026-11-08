/**
 * Accounts that sign in with Microsoft: the sign-in waiting in memory, the
 * refresh token in the credential store, access tokens renewed in memory, and
 * "Sign in again" when Microsoft stops renewing them. The browser, the
 * redirect and the token endpoint are all fakes; nothing calls Microsoft.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzle, type Db } from "../db";
import { runMigrations } from "../db/migrate";
import { openDatabase } from "../db/node-sqlite-shim";
import { mailAccounts } from "../db/schema";
import * as accounts from "./mail-accounts";
import { configureCredentialStore, MemoryCredentialStore } from "./mail-credentials";
import * as signIns from "./mail-sign-in";
import { configureMailboxSource, type MailConnection } from "./mail-source";
import { configureMailTransport, type SmtpConnection } from "./mail-transport";
import type { TokenFetch } from "./microsoft-oauth";
import { configureSettings } from "./settings";

const MIGRATIONS = resolve(process.cwd(), "electron/main/db/migrations");

function idToken(claims: Record<string, unknown>): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

let db: Db;
let store: MemoryCredentialStore;
let clock: number;
let opened: string[];
let tokenCalls: URLSearchParams[];
let tokenReply: (params: URLSearchParams) => { status: number; body: unknown };
let imapSeen: MailConnection[];
let smtpSeen: SmtpConnection[];
let smtpFails: boolean;

const fetchToken: TokenFetch = async (_url, init) => {
	const params = new URLSearchParams(init.body);
	tokenCalls.push(params);
	const answer = tokenReply(params);
	return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
};

function signedInAs(email: string, n = 1) {
	return {
		status: 200,
		body: {
			access_token: `access-${n}`,
			refresh_token: `refresh-${n}`,
			expires_in: 3600,
			id_token: idToken({ email }),
		},
	};
}

beforeEach(() => {
	const connection = openDatabase(":memory:");
	runMigrations(connection, MIGRATIONS);
	db = createDrizzle(connection);
	store = new MemoryCredentialStore();
	configureCredentialStore(store);
	configureSettings(mkdtempSync(join(tmpdir(), "juno-ms-settings-")));

	clock = Date.parse("2026-11-08T10:00:00.000Z");
	opened = [];
	tokenCalls = [];
	tokenReply = () => signedInAs("jan@hotmail.com");
	imapSeen = [];
	smtpSeen = [];
	smtpFails = false;

	signIns.resetMicrosoftSignIn();
	signIns.configureMicrosoftSignIn({
		clientId: "test-client",
		now: () => clock,
		fetchToken,
		openExternal: async (url) => {
			opened.push(url);
		},
		// The browser comes straight back with a code; the real listener is
		// tested on its own in microsoft-oauth.test.ts.
		listen: async () => ({ redirectUri: "http://localhost:50000", code: Promise.resolve("code-1"), close: () => undefined }),
	});
	configureMailboxSource(async (connection) => {
		imapSeen.push(connection);
		return {
			listFolders: async () => [{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" }],
			openFolder: async () => ({ uidValidity: "1", uidNext: 1, exists: 0 }),
			searchUids: async () => [],
			fetchHeaders: async () => [],
			fetchFlags: async () => [],
			fetchSource: async () => null,
			close: async () => undefined,
		};
	});
	configureMailTransport(
		{
			verify: async (connection) => {
				smtpSeen.push(connection);
				if (smtpFails) throw Object.assign(new Error("535 rejected"), { code: "EAUTH" });
			},
			send: async () => ({ raw: Buffer.from(""), accepted: [], rejected: [] }),
		},
		async () => undefined,
	);
});

afterEach(() => {
	signIns.resetMicrosoftSignIn();
});

const outlook = {
	email: "jan@hotmail.com",
	imapHost: "outlook.office365.com",
	imapPort: 993,
	imapSecurity: "tls" as const,
	smtpHost: "smtp-mail.outlook.com",
	smtpPort: 587,
	smtpSecurity: "starttls" as const,
};

describe("signing in with Microsoft", () => {
	it("opens Microsoft's https page in the browser and hands back an id, not a token", async () => {
		const result = await signIns.signIn("Jan@Hotmail.com");
		expect(result.email).toBe("jan@hotmail.com");
		expect(JSON.stringify(result)).not.toMatch(/access-1|refresh-1/);
		expect(opened).toHaveLength(1);
		const url = new URL(opened[0]!);
		expect(url.protocol).toBe("https:");
		expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:50000");
		expect(url.searchParams.get("login_hint")).toBe("jan@hotmail.com");
		expect(tokenCalls[0]!.get("code")).toBe("code-1");
	});

	it("refuses a sign-in to another address than the one typed", async () => {
		tokenReply = () => signedInAs("someone.else@outlook.com");
		await expect(signIns.signIn("jan@hotmail.com")).rejects.toThrow(/signed in to Microsoft as someone.else@outlook.com/);
	});

	it("says it is coming soon while the application ID is empty, without opening anything", async () => {
		signIns.configureMicrosoftSignIn({ clientId: "" });
		expect(signIns.signInConfigured()).toBe(false);
		await expect(signIns.signIn("jan@hotmail.com")).rejects.toThrow(/coming soon/);
		expect(opened).toHaveLength(0);
	});

	it("forgets a sign-in nobody used within fifteen minutes", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		clock += 16 * 60 * 1000;
		expect(() => signIns.pendingAccess(signInId)).toThrow(/no longer waiting/);
	});
});

describe("an account that signs in with Microsoft", () => {
	it("tests both directions with the token, then keeps the refresh token in the credential store", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		const result = await accounts.connect({ ...outlook, signInId }, db);

		expect(result.receiving).toEqual({ ok: true, host: "outlook.office365.com", message: null });
		expect(result.sending).toEqual({ ok: true, host: "smtp-mail.outlook.com", message: null });
		expect(imapSeen[0]).toMatchObject({ username: "jan@hotmail.com", accessToken: "access-1", password: "" });
		expect(smtpSeen[0]).toMatchObject({ username: "jan@hotmail.com", accessToken: "access-1" });

		const account = result.account!;
		expect(account).toMatchObject({ authKind: "microsoft", needsSignIn: false, hasCredential: true });
		expect(JSON.stringify(account)).not.toMatch(/access-1|refresh-1/);
		const row = db.select().from(mailAccounts).get()!;
		expect(row.authKind).toBe("microsoft");
		expect(JSON.stringify(row)).not.toMatch(/access-1|refresh-1/);
		expect(store.get(row.credentialKey)).toBe("refresh-1");

		// The sign-in was used up by the account.
		expect(() => signIns.pendingAccess(signInId)).toThrow();
	});

	it("saves nothing when one direction fails, and says what to do", async () => {
		smtpFails = true;
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		const result = await accounts.connect({ ...outlook, signInId }, db);
		expect(result.account).toBeNull();
		expect(result.receiving.ok).toBe(true);
		expect(result.sending).toMatchObject({ ok: false, host: "smtp-mail.outlook.com" });
		expect(result.sending.message).toMatch(/refused the Microsoft sign-in.*sign in again/);
		expect(await accounts.list(db)).toHaveLength(0);
		// Still waiting, so going back and trying again does not need a new sign-in.
		expect(signIns.pendingAccess(signInId).email).toBe("jan@hotmail.com");
	});

	it("uses the access token in memory until it is nearly spent, then renews and stores the new refresh token", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		const account = (await accounts.create({ ...outlook, signInId }, db));

		expect((await accounts.connectionFor(account.id, db)).accessToken).toBe("access-1");
		expect(tokenCalls).toHaveLength(1);

		clock += 59 * 60 * 1000 + 30 * 1000;
		tokenReply = () => ({ status: 200, body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 } });
		const smtp = await accounts.smtpConnectionFor(account.id, db);
		expect(smtp).toMatchObject({ accessToken: "access-2", username: "jan@hotmail.com", fromAddress: "jan@hotmail.com" });
		expect(tokenCalls[1]!.get("refresh_token")).toBe("refresh-1");
		const row = db.select().from(mailAccounts).get()!;
		expect(store.get(row.credentialKey)).toBe("refresh-2");
	});

	it("says Sign in again when Microsoft refuses the refresh token, and stops asking until a person has", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		const account = await accounts.create({ ...outlook, signInId }, db);
		clock += 2 * 60 * 60 * 1000;
		tokenReply = () => ({ status: 400, body: { error: "invalid_grant" } });

		await expect(accounts.connectionFor(account.id, db)).rejects.toThrow(/sign in again/);
		const marked = (await accounts.get(account.id, db))!;
		expect(marked.needsSignIn).toBe(true);
		expect(marked.lastSyncError).toMatch(/Sign in again/);

		const calls = tokenCalls.length;
		await expect(accounts.connectionFor(account.id, db)).rejects.toThrow(/sign in again/);
		expect(tokenCalls).toHaveLength(calls);

		tokenReply = () => signedInAs("jan@hotmail.com", 3);
		const back = await accounts.signInAgain(account.id, db);
		expect(back).toMatchObject({ needsSignIn: false, lastSyncError: null });
		expect((await accounts.connectionFor(account.id, db)).accessToken).toBe("access-3");
		const row = db.select().from(mailAccounts).get()!;
		expect(store.get(row.credentialKey)).toBe("refresh-3");
	});

	it("has no password to change", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		const account = await accounts.create({ ...outlook, signInId }, db);
		await expect(accounts.update(account.id, { password: "hunter2" }, db)).rejects.toThrow(/signs in with Microsoft/);
	});

	it("will not take a sign-in for another address", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		await expect(accounts.create({ ...outlook, email: "piet@hotmail.com", signInId }, db)).rejects.toThrow(
			/sign-in was for jan@hotmail.com/,
		);
	});

	it("forgets the refresh token on remove", async () => {
		const { signInId } = await signIns.signIn("jan@hotmail.com");
		const account = await accounts.create({ ...outlook, signInId }, db);
		const row = db.select().from(mailAccounts).get()!;
		await accounts.remove(account.id, db);
		expect(store.get(row.credentialKey)).toBeNull();
	});
});

describe("a password account through connect", () => {
	it("is created with the password kind when both directions work", async () => {
		const result = await accounts.connect(
			{
				email: "info@vandamme.be",
				imapHost: "imap.mail.ovh.net",
				smtpHost: "smtp.mail.ovh.net",
				smtpPort: 465,
				password: "secret",
			},
			db,
		);
		expect(result.account).toMatchObject({ authKind: "password", needsSignIn: false, username: "info@vandamme.be" });
		expect(imapSeen[0]).toMatchObject({ password: "secret" });
		expect(imapSeen[0]!.accessToken).toBeUndefined();
	});

	it("still refuses an account with neither a password nor a sign-in, which is all an agent can send", async () => {
		await expect(accounts.create({ email: "a@b.be", imapHost: "imap.b.be" }, db)).rejects.toThrow(/needs a password/);
		await expect(accounts.connect({ email: "a@b.be", imapHost: "imap.b.be", smtpHost: "smtp.b.be" }, db)).rejects.toThrow(
			/password first/,
		);
	});
});
