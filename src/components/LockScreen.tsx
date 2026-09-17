import { useEffect, useRef, useState } from "react";
import type { LockState } from "@shared/types";

type LockScreenProps = {
	state: LockState;
	onUnlocked: () => void;
};

function formatWait(seconds: number): string {
	if (seconds >= 60) {
		const minutes = Math.ceil(seconds / 60);
		return `${minutes} minute${minutes === 1 ? "" : "s"}`;
	}
	return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function LockScreen({ state, onUnlocked }: LockScreenProps) {
	const [secret, setSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [lockedOutUntil, setLockedOutUntil] = useState<string | null>(state.lockedOutUntil);
	const [secondsLeft, setSecondsLeft] = useState(0);
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		input.current?.focus();
	}, []);

	// The clock is read in the interval callback, never during render and never in
	// the effect body. Reading it while rendering makes the output depend on when
	// React happens to re-run the component, and setting state straight from an
	// effect body cascades a second render on every mount.
	useEffect(() => {
		if (!lockedOutUntil) return;
		const id = setInterval(() => {
			const remaining = Date.parse(lockedOutUntil) - Date.now();
			if (remaining <= 0) setLockedOutUntil(null);
			else setSecondsLeft(Math.ceil(remaining / 1000));
		}, 250);
		return () => clearInterval(id);
	}, [lockedOutUntil]);

	// Driven by the penalty itself rather than by the countdown, so the button
	// stays disabled during the quarter second before the first tick lands.
	const waiting = lockedOutUntil !== null;

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (busy || waiting || secret.length === 0) return;
		setBusy(true);
		setError(null);
		try {
			const result = await window.bureau.lock.unlock(secret);
			if (result.ok) {
				setSecret("");
				onUnlocked();
				return;
			}
			setSecret("");
			if (result.reason === "rate-limited" || result.lockedOutUntil) {
				setLockedOutUntil(result.lockedOutUntil ?? null);
				setError("Too many attempts.");
			} else if (result.reason === "not-configured") {
				setError("No lock is configured.");
			} else {
				const left = result.remainingAttempts;
				setError(
					typeof left === "number" && left > 0
						? `That is not right. ${left} attempt${left === 1 ? "" : "s"} left.`
						: "That is not right.",
				);
			}
		} finally {
			setBusy(false);
			input.current?.focus();
		}
	}

	const isPin = state.method === "pin";

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[var(--paper)]">
			<div
				className="w-[340px] rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] p-8 text-center"
				style={{ boxShadow: "var(--shadow-modal)" }}
			>
				<svg viewBox="0 0 64 64" width="44" height="44" fill="none" className="mx-auto" aria-hidden>
					<rect width="64" height="64" rx="14" fill="var(--accent)" />
					<g transform="translate(4.1,3.2) scale(1.8)" fill="var(--accent-ink)">
						<rect x="6" y="6" width="4" height="20" rx="1.5" />
						<rect x="11.5" y="6" width="12" height="9" rx="2.5" />
						<rect x="11.5" y="17" width="13.5" height="9" rx="2.5" />
					</g>
				</svg>

				<h1 className="mt-4 text-[length:var(--text-lg)] font-[var(--weight-medium)]">
					Bureau is locked
				</h1>

				<form onSubmit={submit} className="mt-5">
					<input
						ref={input}
						type="password"
						inputMode={isPin ? "numeric" : "text"}
						autoComplete="off"
						disabled={busy || waiting}
						value={secret}
						onChange={(e) => setSecret(e.target.value)}
						placeholder={isPin ? "PIN" : "Passphrase"}
						aria-label={isPin ? "PIN" : "Passphrase"}
						className="w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-center text-[length:var(--text-base)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none disabled:opacity-60"
					/>

					<button
						type="submit"
						disabled={busy || waiting || secret.length === 0}
						className="mt-3 w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 font-[var(--weight-medium)] text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{busy ? "Checking" : "Unlock"}
					</button>
				</form>

				<p
					role="status"
					aria-live="polite"
					className="mt-3 min-h-[1.25rem] text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{waiting
						? secondsLeft > 0
							? `Too many attempts. Try again in ${formatWait(secondsLeft)}.`
							: "Too many attempts."
						: (error ?? "")}
				</p>

				<p className="mt-4 text-[length:var(--text-micro)] leading-[var(--leading-normal)] text-[var(--ink-muted)]">
					The lock screen protects against someone using this machine. It does not encrypt the
					database on disk.
				</p>
			</div>
		</div>
	);
}
