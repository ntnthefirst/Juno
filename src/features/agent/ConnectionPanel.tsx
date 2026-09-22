import { useEffect, useState } from "react";
import type { McpServerStatus, ToolSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";

type ConnectionPanelProps = {
	onNotice: (message: string) => void;
};

/**
 * How an agent reaches Bureau, and what it can do when it does.
 *
 * The config block is printed with this machine's real paths, because the one
 * thing that makes this feature unusable is guessing at them.
 */
export function ConnectionPanel({ onNotice }: ConnectionPanelProps) {
	const [status, setStatus] = useState<McpServerStatus | null>(null);
	const [tools, setTools] = useState<ToolSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState("");

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.bureau.agent.status(), window.bureau.agent.tools()])
			.then(([current, toolRows]) => {
				if (cancelled) return;
				setStatus(current);
				setTools(toolRows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function copy() {
		if (!status) return;
		try {
			await navigator.clipboard.writeText(status.configJson);
			onNotice("Configuration copied.");
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not read the server state.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (!status) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	const shown = tools.filter((tool) => {
		const needle = filter.trim().toLowerCase();
		return !needle || tool.name.toLowerCase().includes(needle) || tool.title.toLowerCase().includes(needle);
	});
	const readOnly = tools.filter((tool) => tool.readOnly).length;

	return (
		<div className="max-w-[820px]">
			<section>
				<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
					Connecting an agent
				</h2>

				<div className="mt-4 flex items-center gap-3">
					<span
						className={`inline-block h-2 w-2 rounded-[var(--radius-full)] ${status.running ? "bg-[var(--ok)]" : "bg-[var(--risk)]"}`}
						aria-hidden
					/>
					<p className="text-[length:var(--text-dense)]">
						{status.running
							? `Listening. ${status.connections === 0 ? "No agent connected" : `${status.connections} connected`}, ${status.toolCount} tools.`
							: "Not listening."}
					</p>
				</div>
				{status.error ? (
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
						{status.error}
					</p>
				) : null}

				<p className="mt-4 max-w-[68ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					An agent talks to Bureau through a bridge it starts itself. Paste this into the agent's
					MCP configuration. Bureau has to be running, and it will refuse everything while locked.
				</p>

				<pre
					data-selectable
					className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-mono text-[length:var(--text-sm)]"
				>
					{status.configJson}
				</pre>

				<div className="mt-3 flex items-center gap-2">
					<Button onClick={() => void copy()}>Copy configuration</Button>
					<Button onClick={() => void window.bureau.agent.revealConnectionFile()}>
						Show the connection file
					</Button>
				</div>

				<p className="mt-4 max-w-[68ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					The connection file holds a token, and an agent that does not present it is refused. That
					stops something that guessed the address. It does not stop a program already running as
					you, which can read the file: on a machine you are signed in to, that program could read
					the database directly. The lock is the control that matters, and every tool checks it.
				</p>
			</section>

			<section className="mt-10">
				<div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-2">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">
						What an agent can do
					</h2>
					<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{readOnly} read, {tools.length - readOnly} that change something
					</span>
				</div>

				<input
					type="search"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					placeholder="Filter tools"
					aria-label="Filter tools"
					className="mt-3 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
				/>

				<div className="mt-3">
					{shown.map((tool) => (
						<div
							key={tool.name}
							className="flex items-center gap-3 border-b border-[var(--line)] px-2 py-1.5 hover:bg-[var(--hover)]"
						>
							<span className="w-[220px] shrink-0 truncate font-mono text-[length:var(--text-sm)]">
								{tool.name}
							</span>
							<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{tool.title}
							</span>
							<span
								className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${
									tool.readOnly
										? "bg-[var(--sunken)] text-[var(--ink-muted)]"
										: tool.gatedInService
											? "bg-[var(--seal-soft)] text-[var(--seal)]"
											: tool.requiresConfirmation
												? "bg-[var(--warn-soft)] text-[var(--warn)]"
												: "bg-[var(--accent-soft)] text-[var(--accent)]"
								}`}
							>
								{tool.readOnly
									? "reads"
									: tool.gatedInService
										? "you approve the message"
										: tool.requiresConfirmation
											? "you approve"
											: "runs"}
							</span>
						</div>
					))}
					{shown.length === 0 ? (
						<p className="mt-3 text-[var(--ink-muted)]">Nothing matches that.</p>
					) : null}
				</div>
			</section>
		</div>
	);
}
