/**
 * The two parts of the updater that are arithmetic rather than network: how
 * often Juno looks on its own, and how often a person may press the button.
 *
 * Split out of updates.ts for the reason vault-core.ts is split out of
 * vault.ts. That file imports electron-updater, which reaches for a packaged
 * app the moment it loads, so nothing living there can be tested at all. The
 * rate limit is the piece most worth holding still, because getting it wrong
 * means hammering somebody else's server from a button.
 */

/**
 * 38 hours rather than a round 24. A back office is opened at roughly the same
 * time every morning, and a whole number of days lands every check in the same
 * few minutes of the working day, forever. An odd interval walks around the
 * clock instead, so a check that falls while the machine is asleep is not the
 * same check that falls asleep tomorrow.
 */
export const CHECK_INTERVAL_MS = 38 * 60 * 60 * 1000;

/**
 * The first check waits. The thirty seconds after launch belong to opening the
 * mailbox and painting the day, not to a download.
 */
export const FIRST_CHECK_DELAY_MS = 30_000;

/** At most three manual checks a minute. */
export const MANUAL_LIMIT = 3;
export const MANUAL_WINDOW_MS = 60_000;

/**
 * How long until the next automatic check, given when the last one ran.
 *
 * The last check is persisted, so closing and reopening Juno four times in an
 * afternoon is four launches and no extra checks. A clock that moved backwards,
 * or a settings file copied from a machine running ahead, cannot push the next
 * check further out than one interval.
 */
export function nextCheckDelay(lastCheckedAt: string | null, now: number): number {
	const last = lastCheckedAt ? Date.parse(lastCheckedAt) : Number.NaN;
	if (!Number.isFinite(last)) return FIRST_CHECK_DELAY_MS;
	const due = last + CHECK_INTERVAL_MS;
	if (due <= now) return FIRST_CHECK_DELAY_MS;
	return Math.min(due - now, CHECK_INTERVAL_MS);
}

export interface ManualCheckVerdict {
	allowed: boolean;
	/** Milliseconds until the next manual check is allowed. 0 when allowed. */
	retryAfterMs: number;
	/** The window to keep, carrying this call when it was allowed. */
	recent: number[];
}

/**
 * A sliding window rather than a fixed one, so three presses at 59 seconds do
 * not become six presses in two seconds at the turn of the minute.
 *
 * A press recorded in the future is a clock that moved backwards, never a real
 * press, so it is dropped rather than kept. Keeping it would refuse every check
 * until the machine caught up, and the message would say to wait one minute.
 */
export function allowManualCheck(recent: number[], now: number): ManualCheckVerdict {
	const window = recent.filter((at) => at > now - MANUAL_WINDOW_MS && at <= now);
	if (window.length < MANUAL_LIMIT) {
		return { allowed: true, retryAfterMs: 0, recent: [...window, now] };
	}
	const oldest = Math.min(...window);
	const wait = Math.max(1, oldest + MANUAL_WINDOW_MS - now);
	return { allowed: false, retryAfterMs: Math.min(MANUAL_WINDOW_MS, wait), recent: window };
}
