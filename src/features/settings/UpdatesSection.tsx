import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/types";
import { Button } from "../../components/Button";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

function formatWhen(iso: string | null): string {
	if (!iso) return "Never";
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "Never";
	return new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(at);
}

/**
 * The status line, which is the whole point of the section: one sentence
 * saying where the machine is, and never two states at once.
 */
function describe(status: UpdateStatus): string {
	switch (status.stage) {
		case "unsupported":
			return "This is a development build, so there is no published release to compare it against.";
		case "idle":
			return "Not checked yet this session.";
		case "checking":
			return "Checking.";
		case "current":
			return "This is the newest release.";
		case "available":
			return status.autoInstall
				? `Version ${status.newVersion} was found. It downloads in the background.`
				: `Version ${status.newVersion} is available.`;
		case "downloading":
			return `Downloading version ${status.newVersion}. ${status.percent}%.`;
		case "ready":
			return status.autoInstall
				? `Version ${status.newVersion} is ready. It installs the next time Juno closes.`
				: `Version ${status.newVersion} is downloaded and waiting.`;
		case "error":
			return "The last check did not finish.";
	}
}

export function UpdatesSection() {
	const [status, setStatus] = useState<UpdateStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.updates
			.status()
			.then((value) => {
				if (!cancelled) setStatus(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		// A download takes minutes, so the main process pushes rather than this
		// polling for it.
		const off = window.juno.updates.onChange(setStatus);
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	async function run(action: () => Promise<UpdateStatus>) {
		setBusy(true);
		setError(null);
		try {
			setStatus(await action());
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const stage = status?.stage ?? "idle";
	const working = busy || stage === "checking" || stage === "downloading";
	const canInstall = stage === "available" || stage === "ready";

	return (
		<Section
			title="Updates"
			description="Juno looks at the releases published on GitHub, roughly every day and a half, and never while it is locked. Nothing restarts on its own."
			action={
				<Button
					size="dense"
					disabled={working || stage === "unsupported" || status === null}
					onClick={() => void run(() => window.juno.updates.check())}
				>
					{stage === "checking" ? "Checking" : "Check now"}
				</Button>
			}
		>
			{status === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<div className="flex flex-col gap-5">
					<dl className="flex flex-col gap-2 text-[length:var(--text-dense)]">
						<Row label="Version">
							<span className="tabular">{status.currentVersion}</span>
						</Row>
						<Row label="Status">{describe(status)}</Row>
						<Row label="Last checked">
							<span className="tabular">{formatWhen(status.lastCheckedAt)}</span>
						</Row>
					</dl>

					{canInstall ? (
						<div className="flex items-center justify-between gap-4">
							<p className="max-w-[46ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Juno closes and reopens on the new version. Anything unsaved is lost, so
								finish what is open first.
							</p>
							<Button
								variant="primary"
								disabled={working}
								onClick={() => void run(() => window.juno.updates.install())}
							>
								{stage === "ready" ? "Restart and install" : "Install now"}
							</Button>
						</div>
					) : null}

					<Toggle
						checked={status.autoInstall}
						disabled={busy}
						onChange={(value) => void run(() => window.juno.updates.setAutoInstall(value))}
						label="Install updates automatically"
						description={
							status.autoInstall
								? "A new release downloads in the background and is applied the next time you close Juno, so the launch after that is the new version."
								: "Nothing is downloaded until you press Install here."
						}
					/>
				</div>
			)}

			<SectionError message={error ?? status?.error ?? null} />
		</Section>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-4">
			<dt className="w-[92px] shrink-0 text-[var(--ink-muted)]">{label}</dt>
			<dd className="min-w-0">{children}</dd>
		</div>
	);
}
