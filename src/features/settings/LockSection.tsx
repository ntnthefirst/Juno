import { useCallback, useEffect, useState } from "react";
import type { LockSettings, LockState } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

const IDLE_OPTIONS = [
	{ value: "0", label: "Never" },
	{ value: "1", label: "After 1 minute" },
	{ value: "5", label: "After 5 minutes" },
	{ value: "15", label: "After 15 minutes" },
	{ value: "30", label: "After 30 minutes" },
	{ value: "60", label: "After 1 hour" },
];

type Mode = "setup" | "change" | "disable";

export function LockSection() {
	const [state, setState] = useState<LockState | null>(null);
	const [settings, setSettings] = useState<LockSettings | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [mode, setMode] = useState<Mode | null>(null);

	const refresh = useCallback(async () => {
		try {
			const [nextState, nextSettings] = await Promise.all([
				window.juno.lock.state(),
				window.juno.lock.getSettings(),
			]);
			setState(nextState);
			setSettings(nextSettings);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.lock.state(), window.juno.lock.getSettings()])
			.then(([nextState, nextSettings]) => {
				if (cancelled) return;
				setState(nextState);
				setSettings(nextSettings);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		const unsubscribe = window.juno.lock.onChange(setState);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	async function patchSettings(patch: Partial<LockSettings>) {
		setError(null);
		try {
			setSettings(await window.juno.lock.setSettings(patch));
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const configured = state?.configured ?? false;

	return (
		<Section
			title="Lock"
			action={
				configured ? (
					<div className="flex gap-1">
						<Button size="dense" onClick={() => setMode("change")}>
							Change
						</Button>
						<Button size="dense" variant="danger" onClick={() => setMode("disable")}>
							Turn off
						</Button>
					</div>
				) : (
					<Button size="dense" variant="primary" onClick={() => setMode("setup")}>
						Set up a lock
					</Button>
				)
			}
			description={
				<>
					The lock screen protects against someone using this machine while Juno is running. It
					does not encrypt the database on disk, so anyone who can copy the file can still read
					it. Encryption at rest is a separate thing and Juno does not do it yet.
				</>
			}
		>
			<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
				{configured
					? `A ${state?.method === "pin" ? "PIN" : "passphrase"} is set.`
					: "No lock is set. Juno opens straight to your records."}
			</p>

			{configured && settings ? (
				<div className="mt-5 flex max-w-[420px] flex-col gap-4">
					<Select
						label="Lock when idle"
						value={String(settings.idleMinutes)}
						onChange={(value) => void patchSettings({ idleMinutes: Number(value) })}
						options={IDLE_OPTIONS}
					/>
					<Toggle
						label="Lock when the computer sleeps or the screen locks"
						checked={settings.lockOnSleep}
						onChange={(checked) => void patchSettings({ lockOnSleep: checked })}
					/>
					<Toggle
						label="Lock when the window is minimised"
						checked={settings.lockOnMinimise}
						onChange={(checked) => void patchSettings({ lockOnMinimise: checked })}
					/>
				</div>
			) : null}

			<SectionError message={error} />

			{mode ? (
				<LockDialog
					mode={mode}
					method={state?.method ?? "none"}
					onClose={() => setMode(null)}
					onDone={() => {
						setMode(null);
						void refresh();
					}}
				/>
			) : null}
		</Section>
	);
}

function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex cursor-default items-center gap-3 text-[length:var(--text-base)]">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="h-4 w-4 accent-[var(--accent)]"
			/>
			{label}
		</label>
	);
}

function LockDialog({
	mode,
	method,
	onClose,
	onDone,
}: {
	mode: Mode;
	method: LockState["method"];
	onClose: () => void;
	onDone: () => void;
}) {
	const [kind, setKind] = useState<"passphrase" | "pin">(
		method === "pin" ? "pin" : "passphrase",
	);
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [again, setAgain] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const needsCurrent = mode !== "setup";
	const needsNew = mode !== "disable";

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (busy) return;
		setError(null);

		if (needsNew && next !== again) {
			setError("The two entries do not match.");
			return;
		}

		setBusy(true);
		try {
			if (mode === "disable") {
				await window.juno.lock.disable(current);
			} else {
				await window.juno.lock.configure({
					method: kind,
					secret: next,
					currentSecret: needsCurrent ? current : undefined,
				});
			}
			onDone();
		} catch (cause: unknown) {
			// Service errors here are written for people: a wrong current secret, a
			// PIN that is not 4 to 12 digits, an unavailable keychain.
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const title =
		mode === "setup" ? "Set up a lock" : mode === "change" ? "Change the lock" : "Turn off the lock";

	return (
		<Dialog title={title} onClose={onClose} width="narrow">
			<form onSubmit={submit} className="flex flex-col gap-4">
				{mode === "disable" ? (
					<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Juno will open straight to your records after this.
					</p>
				) : null}

				{needsNew ? (
					<Select
						label="Type"
						value={kind}
						onChange={(value) => setKind(value as "passphrase" | "pin")}
						options={[
							{ value: "passphrase", label: "Passphrase, at least 8 characters" },
							{ value: "pin", label: "PIN, 4 to 12 digits" },
						]}
					/>
				) : null}

				{needsCurrent ? (
					<Field
						label={method === "pin" ? "Current PIN" : "Current passphrase"}
						value={current}
						onChange={setCurrent}
						type="text"
						required
					/>
				) : null}

				{needsNew ? (
					<>
						<Field
							label={kind === "pin" ? "New PIN" : "New passphrase"}
							value={next}
							onChange={setNext}
							type="text"
							required
						/>
						<Field
							label="Enter it again"
							value={again}
							onChange={setAgain}
							type="text"
							required
						/>
					</>
				) : null}

				{error ? (
					<p role="alert" className="text-[length:var(--text-sm)] text-[var(--risk)]">
						{error}
					</p>
				) : null}

				{needsNew ? (
					<p className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">
						Juno stores a one-way check of this, never the value itself. There is no way to
						recover it, and no way to reset it from inside the app.
					</p>
				) : null}

				<div className="mt-1 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button
						type="submit"
						variant={mode === "disable" ? "danger" : "primary"}
						disabled={busy}
					>
						{mode === "disable" ? "Turn off" : "Save"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
