import { useEffect, useState } from "react";
import type { McpServerStatus, ToolSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { ClientInstaller } from "./ClientInstaller";
import { ManualSetup } from "./ManualSetup";

type ConnectionPanelProps = {
	onNotice: (message: string) => void;
};

/** Let Juno write the file, or write it yourself. There is no third way in. */
type Route = "install" | "manual";

const ROUTES: { id: Route; label: string; hint: string }[] = [
	{ id: "install", label: "Let Juno do it", hint: "Pick a client and Juno writes its configuration file" },
	{ id: "manual", label: "Do it myself", hint: "Copy the entry and paste it wherever it goes" },
];

/**
 * How an agent reaches Juno, and what it can do when it does.
 *
 * Two routes to the same entry, and one of them is showing at a time: the
 * installers, or the block of configuration to paste. Printing both at once
 * was the old shape, and it read as two jobs rather than one choice, with the
 * paste-it-yourself block sitting under a list that had already done the job.
 *
 * The block is printed with this machine's real paths, because the one thing
 * that makes this feature unusable is guessing at them.
 */
export function ConnectionPanel({ onNotice }: ConnectionPanelProps) {
	const [status, setStatus] = useState<McpServerStatus | null>(null);
	const [tools, setTools] = useState<ToolSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [route, setRoute] = useState<Route>("install");
	const [filter, setFilter] = useState("");

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.agent.status(), window.juno.agent.tools()])
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

	async function recheckStatus() {
		try {
			const current = await window.juno.agent.status();
			setStatus(current);
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
		<div className="mx-auto w-full max-w-[var(--content-width)]">
			<section>
				<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
					Connecting an agent
				</h2>

				<div className="mt-4 flex flex-wrap items-center gap-3">
					<span
						className={`inline-block h-2 w-2 rounded-[var(--radius-full)] ${status.running ? "bg-[var(--ok)]" : "bg-[var(--risk)]"}`}
						aria-hidden
					/>
					<p className="text-[length:var(--text-dense)]">
						{status.running
							? status.connections === 0
								? `Listening, ${status.toolCount} tools, no agent connected.`
								: `Listening. ${status.connections} connected, ${status.toolCount} tools.`
							: "Not listening."}
					</p>
					<Button size="dense" onClick={() => void recheckStatus()}>
						<Icon name="sync" />
						Check again
					</Button>
				</div>
				{status.error ? (
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
						{status.error}
					</p>
				) : null}
				{status.running && status.connections === 0 ? (
					<p className="mt-1 max-w-[68ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						This count does not update on its own. If you just connected a client below, finish
						the restart step it asked for, then press "Check again". Juno also refuses every
						agent while it is locked, so an unlocked window is worth checking too.
					</p>
				) : null}

				<p className="mt-4 max-w-[68ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					An agent talks to Juno through a bridge it starts itself. Juno has to be running,
					and it will refuse everything while locked.
				</p>
			</section>

			<section className="mt-8">
				<div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Connect a client</h2>
					<RouteSwitch route={route} onChange={setRoute} />
				</div>

				<div className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 py-2.5">
					<Icon name="info" className="mt-0.5 flex-none text-[var(--ink-muted)]" />
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						Juno's agent server is local. An agent client starts it itself, as a background
						process on this machine, so there is no server address to type anywhere. Claude's
						"Add custom connector" dialog, which asks for an HTTPS server URL, is for a remote
						server and will not accept Juno: use one of the two routes below instead.
					</p>
				</div>

				<div className="mt-4">
					{route === "install" ? (
						<ClientInstaller onNotice={onNotice} />
					) : (
						<ManualSetup status={status} onNotice={onNotice} />
					)}
				</div>

				<div className="mt-6 flex flex-wrap items-start justify-between gap-4">
					<p className="max-w-[60ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						The connection file holds a token, and an agent that does not present it is refused. That
						stops something that guessed the address. It does not stop a program already running as
						you, which can read the file: on a machine you are signed in to, that program could read
						the database directly. The lock is the control that matters, and every tool checks it.
					</p>
					<Button size="dense" onClick={() => void window.juno.agent.revealConnectionFile()}>
						<Icon name="external" />
						Show the connection file
					</Button>
				</div>
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

type RouteSwitchProps = {
	route: Route;
	onChange: (next: Route) => void;
};

/** Two buttons in one well: the same choice a radio pair makes, in one row. */
function RouteSwitch({ route, onChange }: RouteSwitchProps) {
	return (
		<div
			role="radiogroup"
			aria-label="How to connect a client"
			className="flex gap-0.5 rounded-[var(--radius-md)] bg-[var(--sunken)] p-0.5"
		>
			{ROUTES.map((option) => {
				const selected = option.id === route;
				return (
					<button
						key={option.id}
						type="button"
						role="radio"
						aria-checked={selected}
						title={option.hint}
						onClick={() => onChange(option.id)}
						className={[
							"flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-[length:var(--text-dense)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]",
							selected
								? "bg-[var(--surface)] font-[var(--weight-medium)] text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]"
								: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
