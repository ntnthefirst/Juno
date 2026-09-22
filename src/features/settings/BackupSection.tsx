import { useCallback, useEffect, useState } from "react";
import type { BackupInfo } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["kB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatWhen(iso: string): string {
	const date = new Date(iso);
	return new Intl.DateTimeFormat("nl-BE", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

export function BackupSection({ onDone }: { onDone: (message: string) => void }) {
	const [backups, setBackups] = useState<BackupInfo[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirming, setConfirming] = useState<BackupInfo | null>(null);

	const refresh = useCallback(async () => {
		try {
			setBackups(await window.juno.backup.list());
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.juno.backup
			.list()
			.then((value) => {
				if (!cancelled) setBackups(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function create() {
		setBusy(true);
		setError(null);
		try {
			await window.juno.backup.create();
			await refresh();
			onDone("Backup created.");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function restore(backup: BackupInfo) {
		setConfirming(null);
		setError(null);
		try {
			await window.juno.backup.restore(backup.path);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	return (
		<Section
			title="Backup"
			description="The database is a single file on this machine, so nothing is backed up anywhere else unless you do it. A backup is a copy of that file."
			action={
				<div className="flex gap-1">
					<Button size="dense" onClick={() => void window.juno.backup.revealFolder()}>
						Show folder
					</Button>
					<Button size="dense" variant="primary" disabled={busy} onClick={() => void create()}>
						Back up now
					</Button>
				</div>
			}
		>
			{backups === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : backups.length === 0 ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No backups yet.
				</p>
			) : (
				<ul className="max-w-[620px]">
					{backups.map((backup) => (
						<li
							key={backup.path}
							className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
						>
							<span className="tabular min-w-0 truncate">
								{formatWhen(backup.createdAt)}
								<span className="text-[var(--ink-muted)]">
									{"  ·  "}
									{formatSize(backup.sizeBytes)}
								</span>
							</span>
							<Button size="dense" variant="danger" onClick={() => setConfirming(backup)}>
								Restore
							</Button>
						</li>
					))}
				</ul>
			)}

			<SectionError message={error} />

			{confirming ? (
				<Dialog title="Restore this backup" onClose={() => setConfirming(null)} width="narrow">
					<p className="text-[length:var(--text-base)]">
						Everything currently in Juno is replaced by the copy from{" "}
						{formatWhen(confirming.createdAt)}. Anything added since then is lost, and Juno
						closes once it is done.
					</p>
					<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Back up now first if you are not certain.
					</p>
					<div className="mt-5 flex justify-end gap-2">
						<Button onClick={() => setConfirming(null)}>Cancel</Button>
						<Button variant="danger" onClick={() => void restore(confirming)}>
							Replace everything
						</Button>
					</div>
				</Dialog>
			) : null}
		</Section>
	);
}
