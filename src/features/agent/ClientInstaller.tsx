import { useCallback, useEffect, useState } from "react";
import type { AgentClientTarget, AgentInstallResult } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { ClientLogo } from "./client-logos";

type ClientInstallerProps = {
	onNotice: (message: string) => void;
};

type Done = { target: AgentClientTarget; result: AgentInstallResult };

/** Where a row stands, in the order the states are worth telling apart. */
type Standing = "connected" | "elsewhere" | "ready" | "no-file" | "absent";

function standingOf(target: AgentClientTarget): Standing {
	if (target.upToDate) return "connected";
	if (target.configured) return "elsewhere";
	if (target.hasConfigFile) return "ready";
	if (target.installed) return "no-file";
	return "absent";
}

/**
 * Connecting Juno to the agent clients on this machine, one button each.
 *
 * Each row writes one file and says what it did afterwards: where it wrote,
 * where the backup went, and what has to be restarted. None of it happens
 * until a named client is asked for.
 *
 * The row says two separate things, because one sentence used to stand for
 * both and read as the wrong one: whether the client is on this machine, and
 * whether it has an MCP file yet. "No configuration file yet" against an
 * installed Claude Desktop reads as "Juno cannot find Claude", which was never
 * what it meant.
 */
export function ClientInstaller({ onNotice }: ClientInstallerProps) {
	const [targets, setTargets] = useState<AgentClientTarget[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [done, setDone] = useState<Done | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		window.juno.agent.install
			.targets()
			.then(setTargets)
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(refresh, [refresh]);

	async function write(target: AgentClientTarget) {
		setBusy(target.id);
		setError(null);
		try {
			const result = await window.juno.agent.install.write(target.id);
			setDone({ target, result });
			onNotice(`${result.name} configured.`);
			refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	if (targets === null && error === null) {
		return <p className="text-[var(--ink-muted)]">Loading.</p>;
	}

	// What is on the machine first. A client that is not installed is still
	// offered, at the bottom, because writing the file is what makes it pick
	// Juno up the first time it starts.
	const rows = [...(targets ?? [])].sort(
		(a, b) => Number(b.installed) - Number(a.installed),
	);
	const absent = rows.filter((target) => !target.installed).length;

	return (
		<div>
			<p className="max-w-[68ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
				Juno can write itself into these directly. Each one edits a single file, copies the
				old one beside it first, and leaves every other server in it alone.
			</p>

			<ul className="mt-4">
				{rows.map((target) => (
					<li
						key={target.id}
						className="flex items-center gap-3 border-b border-[var(--line)] py-2"
					>
						<span
							className={
								target.installed
									? "flex h-8 w-8 flex-none items-center justify-center text-[var(--ink)]"
									: "flex h-8 w-8 flex-none items-center justify-center text-[var(--ink-faint)]"
							}
						>
							<ClientLogo clientId={target.id} />
						</span>

						<span className="min-w-0 flex-1">
							<span className="flex flex-wrap items-center gap-2">
								<span className="font-[var(--weight-medium)]">{target.name}</span>
								<Standing standing={standingOf(target)} />
								{target.format === "toml" ? (
									<span className="text-[length:var(--text-micro)] uppercase tracking-[0.06em] text-[var(--ink-faint)]">
										toml
									</span>
								) : null}
							</span>
							{target.path ? (
								<span
									data-selectable
									className="mt-0.5 block truncate font-mono text-[length:var(--text-micro)] text-[var(--ink-faint)]"
									title={target.path}
								>
									{target.path}
								</span>
							) : null}
						</span>

						<Button
							size="dense"
							variant={target.upToDate || !target.installed ? "quiet" : "primary"}
							disabled={busy !== null || target.path === null}
							onClick={() => void write(target)}
						>
							{busy === target.id
								? "Writing"
								: target.upToDate
									? "Write again"
									: target.configured
										? "Update"
										: "Connect"}
						</Button>
					</li>
				))}
			</ul>

			{absent > 0 ? (
				<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					The greyed ones are not on this machine. Connecting one anyway writes the file it
					would read, which it picks up the first time it starts.
				</p>
			) : null}

			{done ? (
				<div className="mt-4 border-l-2 border-[var(--ok)] pl-3">
					<p className="text-[length:var(--text-dense)] font-[var(--weight-medium)]">
						{done.result.created
							? `Created ${done.result.name}'s configuration.`
							: `Updated ${done.result.name}'s configuration.`}
					</p>
					<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{done.result.after}
					</p>
					{done.result.backupPath ? (
						<p
							data-selectable
							className="mt-1 font-mono text-[length:var(--text-micro)] text-[var(--ink-faint)]"
						>
							Previous file kept at {done.result.backupPath}
						</p>
					) : null}
				</div>
			) : null}

			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}
		</div>
	);
}

type StandingProps = {
	standing: Standing;
};

function Standing({ standing }: StandingProps) {
	if (standing === "connected") {
		return (
			<span className="flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--ok)]">
				<Icon name="check" size={13} />
				Connected
			</span>
		);
	}
	if (standing === "elsewhere") {
		return (
			<span className="text-[length:var(--text-sm)] text-[var(--warn)]">
				Configured, but pointing somewhere else
			</span>
		);
	}
	if (standing === "ready") {
		return (
			<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Not connected yet</span>
		);
	}
	if (standing === "no-file") {
		return (
			<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Installed, with no MCP servers of its own yet
			</span>
		);
	}
	return (
		<span className="text-[length:var(--text-sm)] text-[var(--ink-faint)]">Not on this machine</span>
	);
}
