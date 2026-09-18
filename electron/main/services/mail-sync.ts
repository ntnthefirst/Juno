/**
 * The sync loop: pulls each enabled folder of each account into SQLite,
 * headers first and bodies second, resumably.
 *
 * Every run is bounded. A folder with forty thousand messages is pulled a few
 * thousand headers and a few hundred bodies at a time, and the next run picks
 * up where this one stopped, because "what is missing" is recomputed from the
 * rows rather than remembered in a cursor that can go stale. UIDVALIDITY is
 * checked on every open, and a change throws the folder's local state away.
 *
 * Nothing in here writes to the server. The source interface has no method
 * that could.
 */
import type { MailSyncStatus } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { eq } from "drizzle-orm";
import { mailFolders } from "../db/schema";
import * as accounts from "./mail-accounts";
import { MAX_SOURCE_BYTES, parseMessage } from "./mail-parse";
import { describeMailError, openMailbox, type MailboxSource } from "./mail-source";
import * as store from "./mail-store";

/** Headers pulled per folder per run. */
const HEADER_BATCH = 2000;
/** Bodies pulled per folder per run. Each is a round trip, so this is the slow part. */
const BODY_BATCH = 150;
/** How many of the newest local messages get their flags refreshed per run. */
const FLAG_REFRESH = 1000;
/** Headers stored per transaction. */
const STORE_CHUNK = 250;

const SCHEDULER_TICK_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 8 * 1000;

type Listener = (status: MailSyncStatus) => void;

interface SyncConfig {
	mailDir: string;
	/** True while the app is locked. No sync starts, and a running one stops early. */
	isPaused?: () => boolean;
}

let config: SyncConfig | null = null;
const listeners = new Set<Listener>();
const statuses = new Map<string, MailSyncStatus>();
const running = new Set<string>();
let schedulerTimer: NodeJS.Timeout | null = null;

export function configureMailSync(next: SyncConfig): void {
	config = next;
}

function mailDir(): string {
	if (!config) throw new Error("Mail sync was used before the app configured it.");
	return config.mailDir;
}

function paused(): boolean {
	return config?.isPaused?.() ?? false;
}

function idle(accountId: string): MailSyncStatus {
	return {
		accountId,
		phase: "idle",
		folderPath: null,
		done: 0,
		total: 0,
		startedAt: null,
		finishedAt: null,
		error: null,
		newMessages: 0,
		fetchedBodies: 0,
	};
}

function publish(status: MailSyncStatus): void {
	statuses.set(status.accountId, status);
	for (const listener of listeners) listener(status);
}

export function onChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The last known state of every account that has been synced this session. */
export function status(): MailSyncStatus[] {
	return [...statuses.values()];
}

export function statusFor(accountId: string): MailSyncStatus {
	return statuses.get(accountId) ?? idle(accountId);
}

export function isRunning(accountId?: string): boolean {
	return accountId ? running.has(accountId) : running.size > 0;
}

function horizonDate(days: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() - days);
	return date.toISOString().slice(0, 10);
}

class SyncStopped extends Error {
	constructor() {
		super("Sync stopped because Bureau was locked.");
		this.name = "SyncStopped";
	}
}

function checkPaused(): void {
	if (paused()) throw new SyncStopped();
}

async function syncFolder(
	db: Db,
	source: MailboxSource,
	account: { id: string; email: string; username: string; horizonDays: number },
	folder: store.FolderRow,
	progress: MailSyncStatus,
): Promise<void> {
	const step = (patch: Partial<MailSyncStatus>) => publish({ ...progress, ...patch, folderPath: folder.path });

	checkPaused();
	const mailbox = await source.openFolder(folder.path);

	if (folder.uidValidity !== null && folder.uidValidity !== mailbox.uidValidity) {
		store.resetFolder(db, folder.id, mailbox.uidValidity);
		folder = { ...folder, uidValidity: mailbox.uidValidity, syncedHorizonDays: null };
	}

	const local = store.localUids(db, folder.id);
	const minLocal = local[0];
	const needsListing = local.length === 0 || folder.syncedHorizonDays !== account.horizonDays;

	// Everything the server has from the horizon on, plus everything at or above
	// the oldest local UID, which is what makes deletions detectable: any local
	// message the server no longer lists in that range is gone.
	const serverUids = await source.searchUids({
		...(needsListing ? { since: horizonDate(account.horizonDays) } : {}),
		...(minLocal !== undefined ? { uidFrom: minLocal } : {}),
	});
	const present = new Set(serverUids);
	const have = new Set(local);

	if (minLocal !== undefined) store.markMissing(db, folder.id, present);

	const missing = serverUids.filter((uid) => !have.has(uid)).sort((a, b) => b - a).slice(0, HEADER_BATCH);
	const own = store.ownAddressesFor(account.email, account.username);

	step({ phase: "headers", done: 0, total: missing.length });
	for (let i = 0; i < missing.length; i += STORE_CHUNK) {
		checkPaused();
		const headers = await source.fetchHeaders(missing.slice(i, i + STORE_CHUNK));
		let created = 0;
		db.transaction(() => {
			for (const header of headers) {
				if (store.storeHeader(db, account.id, folder.id, header, own).created) created += 1;
			}
		});
		progress.newMessages += created;
		step({ phase: "headers", done: Math.min(i + STORE_CHUNK, missing.length), total: missing.length });
	}

	// Read and flagged states move on the server without the message changing.
	// The newest thousand cover what a person is likely to be looking at.
	const fetchedSet = new Set(missing);
	const refresh = local.filter((uid) => !fetchedSet.has(uid)).slice(-FLAG_REFRESH);
	if (refresh.length > 0) {
		checkPaused();
		const flags = await source.fetchFlags(refresh);
		db.transaction(() => {
			store.applyFlags(db, folder.id, flags);
		});
	}

	const pending = store.pendingBodies(db, folder.id, BODY_BATCH);
	step({ phase: "bodies", done: 0, total: pending.length });
	for (const [index, message] of pending.entries()) {
		checkPaused();
		try {
			const raw = await source.fetchSource(message.uid, MAX_SOURCE_BYTES);
			if (raw === null) {
				store.storeBodyError(db, message.id, "The server no longer has this message.");
				continue;
			}
			const parsed = await parseMessage(raw);
			store.storeBody(db, message.id, parsed, mailDir());
			progress.fetchedBodies += 1;
		} catch (error) {
			// One unparseable message must not stop the rest, and must not be
			// retried on every run either.
			store.storeBodyError(
				db,
				message.id,
				error instanceof Error ? error.message.slice(0, 500) : "Could not read this message.",
			);
		}
		if ((index + 1) % 10 === 0 || index + 1 === pending.length) {
			step({ phase: "bodies", done: index + 1, total: pending.length });
		}
	}

	db.update(mailFolders)
		.set({
			uidValidity: mailbox.uidValidity,
			uidNext: mailbox.uidNext,
			syncedHorizonDays: account.horizonDays,
			lastSyncAt: now(),
			updatedAt: now(),
		})
		.where(eq(mailFolders.id, folder.id))
		.run();
	store.refreshFolderCounts(db, folder.id);
}

/**
 * One full pass over an account. Returns the final status; the same object is
 * also published to listeners along the way. A second call for an account
 * already running returns that run's current status rather than starting
 * another connection to the same server.
 */
export async function syncAccount(accountId: string, db: Db = getDb()): Promise<MailSyncStatus> {
	if (running.has(accountId)) return statusFor(accountId);
	if (paused()) return statusFor(accountId);

	const account = await accounts.get(accountId, db);
	if (!account) throw new Error("That mail account does not exist.");

	running.add(accountId);
	const progress: MailSyncStatus = {
		...idle(accountId),
		phase: "connecting",
		startedAt: now(),
	};
	publish(progress);

	let source: MailboxSource | null = null;
	let connection: { host: string; username: string } = { host: account.imapHost, username: account.username };
	try {
		const details = accounts.connectionFor(accountId, db);
		connection = { host: details.host, username: details.username };
		source = await openMailbox(details);

		publish({ ...progress, phase: "folders" });
		const folders = store.reconcileFolders(db, accountId, await source.listFolders());

		// Inbox first: it is the folder people are waiting on.
		const enabled = folders
			.filter((f) => f.syncEnabled)
			.sort((a, b) => (a.specialUse === "inbox" ? -1 : b.specialUse === "inbox" ? 1 : a.path.localeCompare(b.path)));

		for (const folder of enabled) {
			await syncFolder(db, source, account, folder, progress);
		}

		await accounts.recordSync(accountId, { error: null }, db);
		const finished: MailSyncStatus = { ...progress, phase: "done", folderPath: null, finishedAt: now() };
		publish(finished);
		return finished;
	} catch (error) {
		const message =
			error instanceof SyncStopped
				? error.message
				: describeMailError(error, connection);
		if (!(error instanceof SyncStopped)) {
			await accounts.recordSync(accountId, { error: message }, db);
		}
		const failed: MailSyncStatus = {
			...progress,
			phase: "failed",
			folderPath: null,
			finishedAt: now(),
			error: message,
		};
		publish(failed);
		return failed;
	} finally {
		running.delete(accountId);
		// Logged out on every path. A leaked connection is a locked-out account.
		await source?.close().catch(() => undefined);
	}
}

/** Every enabled account, one after another. Two servers at once is fine; one server twice is not. */
export async function syncAll(db: Db = getDb()): Promise<MailSyncStatus[]> {
	const all = await accounts.list(db);
	const results: MailSyncStatus[] = [];
	for (const account of all) {
		if (!account.syncEnabled) continue;
		results.push(await syncAccount(account.id, db));
	}
	return results;
}

function due(account: { id: string; syncEnabled: boolean; syncIntervalMinutes: number; lastSyncAt: string | null; lastSyncError: string | null }): boolean {
	if (!account.syncEnabled || running.has(account.id)) return false;
	const last = statuses.get(account.id)?.finishedAt ?? account.lastSyncAt;
	if (!last) return true;
	// A failing account is retried at the same interval, not hammered.
	return Date.now() - Date.parse(last) >= account.syncIntervalMinutes * 60 * 1000;
}

async function tick(): Promise<void> {
	if (paused()) return;
	const all = await accounts.list();
	for (const account of all) {
		if (due(account)) await syncAccount(account.id);
	}
}

/** Starts the background schedule: shortly after launch, then per account interval. */
export function startScheduler(): void {
	if (schedulerTimer) return;
	setTimeout(() => void tick().catch(() => undefined), FIRST_RUN_DELAY_MS).unref();
	schedulerTimer = setInterval(() => void tick().catch(() => undefined), SCHEDULER_TICK_MS);
	schedulerTimer.unref();
}

export function stopScheduler(): void {
	if (schedulerTimer) clearInterval(schedulerTimer);
	schedulerTimer = null;
}

/** Test seam. Never called by application code. */
export function resetForTests(): void {
	statuses.clear();
	running.clear();
	listeners.clear();
	stopScheduler();
}
