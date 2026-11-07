import { useEffect, useId, useRef, useState } from "react";
import type { LockState } from "@shared/types";
import { Button } from "./Button";
import { Icon } from "./Icon";

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
	const inputId = useId();

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
			const result = await window.juno.lock.unlock(secret);
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
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--paper)] pb-16">
			<div className="flex w-[280px] flex-col items-stretch">
				<span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--accent-soft)] text-[var(--accent)]">
					<Icon name="lock" size={24} />
				</span>

				<h1 className="mt-4 text-center text-h3">Juno is locked</h1>
				<p className="mt-1.5 text-center text-dense text-[var(--ink-muted)]">
					{isPin ? "Enter your PIN to continue." : "Enter your passphrase to continue."}
				</p>

				<form onSubmit={submit} className="mt-6">
					<label htmlFor={inputId} className="mb-1.5 block text-sm font-[var(--weight-medium)]">
						{isPin ? "PIN" : "Passphrase"}
					</label>
					<input
						id={inputId}
						ref={input}
						type="password"
						inputMode={isPin ? "numeric" : "text"}
						autoComplete="off"
						disabled={busy || waiting}
						value={secret}
						onChange={(e) => setSecret(e.target.value)}
						className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)] disabled:opacity-60"
					/>

					<div className="mt-4 flex justify-center">
						<Button type="submit" variant="primary" disabled={busy || waiting || secret.length === 0}>
							{busy ? "Checking" : "Unlock"}
						</Button>
					</div>
				</form>

				<p
					role="status"
					aria-live="polite"
					className="mt-3 min-h-[1.25rem] text-center text-sm text-[var(--risk)]"
				>
					{waiting
						? secondsLeft > 0
							? `Too many attempts. Try again in ${formatWait(secondsLeft)}.`
							: "Too many attempts."
						: (error ?? "")}
				</p>
			</div>
		</div>
	);
}
