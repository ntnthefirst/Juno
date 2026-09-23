import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { AgentClientTarget, McpServerStatus } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { snippetFor } from "./format";

type ManualSetupProps = {
	status: McpServerStatus;
	onNotice: (message: string) => void;
};

/**
 * The step-by-step plan for a person who would rather edit a file than let
 * Juno do it, or whose client is not one of the ones Juno can write to
 * directly.
 *
 * A block of JSON with no destination is not a set of instructions: it reads
 * as code, not as steps. Picking the client first is what turns this into
 * "here is what to do", because the file, the key inside it and what to
 * restart afterwards are different for every one of them.
 */
export function ManualSetup({ status, onNotice }: ManualSetupProps) {
	const [targets, setTargets] = useState<AgentClientTarget[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);

	const refresh = useCallback(() => {
		window.juno.agent.install
			.targets()
			.then((rows) => {
				setTargets(rows);
				setSelected((current) => current ?? rows.find((row) => row.installed)?.id ?? (rows[0]?.id ?? null));
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(refresh, [refresh]);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			onNotice("Entry copied.");
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the client list.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (targets === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	// Installed clients first, the way the installer list orders them, so the
	// one most likely to be the right answer is also the one on top.
	const rows = [...targets].sort((a, b) => Number(b.installed) - Number(a.installed));
	const target = rows.find((row) => row.id === selected) ?? rows[0] ?? null;
	const key = target?.configKey ?? "mcpServers";
	const snippet = target && target.path ? snippetFor(target, status) : "";

	return (
		<div>
			<Select
				label="Which client are you setting up"
				value={target?.id ?? ""}
				onChange={setSelected}
				options={rows.map((row) => ({
					value: row.id,
					label: row.installed ? row.name : `${row.name} (not on this machine)`,
				}))}
			/>

			{target === null ? null : target.path === null ? (
				<p className="mt-4 text-[var(--ink-muted)]">
					{target.name} has no known configuration file on this platform.
				</p>
			) : (
				<ol className="mt-5">
					<Step number={1} title="Open its configuration file">
						<p
							data-selectable
							className="overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--sunken)] px-3 py-2 font-mono text-[length:var(--text-sm)] text-[var(--ink)]"
						>
							{target.path}
						</p>
						<p>
							{target.hasConfigFile
								? "This file already exists on this machine. Open it in a text editor."
								: "This file does not exist yet. Create it, and any folders in the path that are missing, when you save."}
						</p>
						{target.id === "claude-desktop" ? (
							<p>
								Or from inside Claude Desktop itself: open Settings, then Developer, then Edit
								config. That opens this same file.
							</p>
						) : null}
					</Step>

					<Step number={2} title="Add the Juno entry">
						<pre
							data-selectable
							className="overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-mono text-[length:var(--text-sm)] text-[var(--ink)]"
						>
							{snippet}
						</pre>
						<p>
							{target.format === "toml"
								? `Paste this in as its own table. If the file already has other [${key}.*] tables for other servers, this one sits beside them.`
								: `Paste this inside the file. If it already has a "${key}" object with other servers in it, add "juno" as one more entry inside that object, rather than replacing the file. If there is no "${key}" object yet, this block can be the whole file.`}
						</p>
						<div>
							<Button size="dense" onClick={() => void copy(snippet)}>
								<Icon name="copy" />
								Copy the entry
							</Button>
						</div>
					</Step>

					<Step number={3} title="Restart it">
						<div className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--warn-soft)] px-3 py-2.5">
							<Icon name="sync" className="mt-0.5 flex-none text-[var(--warn)]" />
							<p className="font-[var(--weight-medium)] text-[var(--warn)]">{target.after}</p>
						</div>
					</Step>
				</ol>
			)}
		</div>
	);
}

type StepProps = {
	number: number;
	title: string;
	children: ReactNode;
};

/** One numbered stop in the plan, its body a column of short paragraphs. */
function Step({ number, title, children }: StepProps) {
	return (
		<li className="flex gap-3 border-b border-[var(--line)] py-4 first:pt-0 last:border-b-0">
			<span
				aria-hidden
				className="tabular mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent-soft)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--accent)]"
			>
				{number}
			</span>
			<div className="min-w-0 flex-1">
				<p className="font-[var(--weight-medium)]">{title}</p>
				<div className="mt-2 flex flex-col gap-2 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					{children}
				</div>
			</div>
		</li>
	);
}
