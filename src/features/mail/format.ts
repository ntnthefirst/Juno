import type { MailAddress, MailFileResult, MailSyncStatus } from "@shared/types";

/**
 * A message time the way a list shows it: the clock for today, the weekday
 * for this week, the date otherwise. Rendering is the one place local time is
 * allowed, per .claude/rules/data.md.
 */
export function formatWhen(iso: string, now = new Date()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (sameDay) {
		return date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
	}
	const days = (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
	if (days < 6 && days > 0) {
		return date.toLocaleDateString("en-GB", { weekday: "short" });
	}
	if (date.getFullYear() === now.getFullYear()) {
		return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	}
	return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * When an account last synced, short enough to sit beside its name. The clock
 * for today, "Yesterday", then the weekday, then the date. Longer than a list
 * row's stamp on purpose: "Tue" is fine on a message, but on a sync it has to
 * say plainly that nothing has run since.
 */
export function formatSyncWhen(iso: string, now = new Date()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const days = Math.floor((midnight.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / (24 * 60 * 60 * 1000));
	if (days <= 0) return date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
	if (days === 1) return "Yesterday";
	if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "short" });
	if (date.getFullYear() === now.getFullYear()) {
		return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	}
	return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The full timestamp, for a message header. */
export function formatFull(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** A person's name if the message gave one, else the address. */
export function displayName(address: MailAddress): string {
	return address.name?.trim() || address.address;
}

/** "Laura, Tom and 2 more" for a list row. */
export function participantsLine(people: MailAddress[], fallback = "(nobody)"): string {
	if (people.length === 0) return fallback;
	const names = people.map((p) => (p.name?.trim() || p.address.split("@")[0]) ?? p.address);
	if (names.length <= 3) return names.join(", ");
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${Math.round(size / 1024)} kB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** One line for the status area. Honest about what failed. */
export function describeSync(status: MailSyncStatus | null, lastSyncAt: string | null): string {
	if (!status || status.phase === "idle") {
		return lastSyncAt ? `Last synced ${formatWhen(lastSyncAt)}` : "Not synced yet";
	}
	switch (status.phase) {
		case "connecting":
			return "Connecting";
		case "folders":
			return "Listing folders";
		case "headers":
			return status.total > 0
				? `Fetching headers in ${status.folderPath ?? ""}: ${status.done} of ${status.total}`
				: `Checking ${status.folderPath ?? ""}`;
		case "bodies":
			return status.total > 0
				? `Fetching messages in ${status.folderPath ?? ""}: ${status.done} of ${status.total}`
				: `Checking ${status.folderPath ?? ""}`;
		case "done":
			return status.newMessages > 0
				? `Synced ${status.finishedAt ? formatWhen(status.finishedAt) : ""}, ${status.newMessages} new`
				: `Synced ${status.finishedAt ? formatWhen(status.finishedAt) : ""}`;
		case "failed":
			return status.error ?? "Sync failed.";
	}
}

export function isSyncing(status: MailSyncStatus | null): boolean {
	return (
		status !== null &&
		status.phase !== "idle" &&
		status.phase !== "done" &&
		status.phase !== "failed"
	);
}

/**
 * What a filing action actually did, honestly. A server without UIDPLUS
 * cannot say where a message landed, so the row disappears until the next
 * sync brings it back in its new folder. That is worth saying out loud
 * rather than letting the count alone imply it is already sitting there.
 */
export function describeMailFileResult(verb: string, count: number, result: MailFileResult): string {
	const noun = count === 1 ? "thread" : "threads";
	const base = `${count} ${noun} ${verb}.`;
	if (result.moved > 0 && result.remembered === 0) {
		const pronoun = count === 1 ? "It" : "They";
		return `${base} ${pronoun} will reappear in ${result.folderName} after the next sync.`;
	}
	return base;
}
