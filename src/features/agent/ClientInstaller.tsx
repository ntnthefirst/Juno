import { useCallback, useEffect, useState } from "react";
import type { AgentClientTarget, AgentInstallResult } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";

type ClientInstallerProps = {
	onNotice: (message: string) => void;
};

type Done = { target: AgentClientTarget; result: AgentInstallResult };

/**
 * Connecting Juno to the agent clients on this machine, one button each.
 *
 * The alternative, which this sits above, is copying a block of JSON into a
 * file whose path differs per client and per platform and merging it by hand
 * without breaking the servers already there. That block is still printed,
 * because a client Juno has not heard of still needs it.
 *
 * Each row writes one file and says what it did afterwards: where it wrote,
 * where the backup went, and what has to be restarted. None of it happens
 * until a named client is asked for.
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

	return (
		<div>
			<p className="max-w-[68ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
				Juno can write itself into these directly. Each one edits a single file, copies the
				old one beside it first, and leaves every other server in it alone.
			</p>

			<ul className="mt-4">
				{(targets ?? []).map((target) => (
					<li
						key={target.id}
						className="flex items-center gap-3 border-b border-[var(--line)] py-2"
					>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-2">
								<span className="font-[var(--weight-medium)]">{target.name}</span>
								{target.upToDate ? (
									<span className="flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--ok)]">
										<Icon name="check" size={13} />
										Connected
									</span>
								) : target.configured ? (
									<span className="text-[length:var(--text-sm)] text-[var(--warn)]">
										Configured, but pointing somewhere else
									</span>
								) : target.found ? (
									<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										Found, not connected
									</span>
								) : (
									<span className="text-[length:var(--text-sm)] text-[var(--ink-faint)]">
										No configuration file yet
									</span>
								)}
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
							variant={target.upToDate ? "quiet" : "primary"}
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
