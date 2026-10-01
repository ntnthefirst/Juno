import { useCallback, useEffect, useState } from "react";
import type { McpServerStatus, ToolSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { ClientInstaller } from "./ClientInstaller";
import { ConnectedClients } from "./ConnectedClients";
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
 * How an agent reaches Juno, who has been let in, and what it can do.
 *
 * The server is an address, the way Figma's is: a client is given the URL and
 * nothing else. The first time it connects it opens a page with a code and
 * Juno asks for that code, so there is no key to copy and none to leak.
 */
export function ConnectionPanel({ onNotice }: ConnectionPanelProps) {
	const [status, setStatus] = useState<McpServerStatus | null>(null);
	const [tools, setTools] = useState<ToolSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [route, setRoute] = useState<Route>("install");
	const [filter, setFilter] = useState("");
	const [switching, setSwitching] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.agent.server.status(), window.juno.agent.tools()])
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

	const run = useCallback(
		async (change: () => Promise<McpServerStatus>) => {
			setSwitching(true);
			try {
				setStatus(await change());
			} catch (cause: unknown) {
				onNotice(messageOf(cause));
			} finally {
				setSwitching(false);
			}
		},
		[onNotice],
	);

	async function copy(text: string, done: string) {
		try {
			await navigator.clipboard.writeText(text);
			onNotice(done);
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
			<section data-setting="mcp-server" className="mt-10 border-t border-[var(--line-strong)] pt-8 first:mt-0 first:border-t-0 first:pt-0">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">MCP server</h2>

				<div className="mt-4">
					<Toggle
						label="Let agents connect"
						description="Juno answers on this computer only. An agent has to be let in once, with a code."
						checked={status.enabled}
						disabled={switching}
						onChange={(next) => void run(() => window.juno.agent.server.setEnabled(next))}
					/>
				</div>

				<div className="mt-4 flex flex-wrap items-center gap-3">
					<span
						className={`inline-block h-2 w-2 rounded-[var(--radius-full)] ${status.running ? "bg-[var(--ok)]" : status.enabled ? "bg-[var(--risk)]" : "bg-[var(--ink-faint)]"}`}
						aria-hidden
					/>
					<p className="text-[length:var(--text-dense)]">
						{status.running
							? `Listening, ${status.toolCount} tools.`
							: status.enabled
								? "Not listening."
								: "Off. Nothing can connect."}
					</p>
				</div>
				{status.error ? (
					<p data-selectable role="alert" className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
						{status.error}
					</p>
				) : null}

				<div className="mt-4 flex items-center gap-2">
					<p
						data-selectable
						className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] bg-[var(--sunken)] px-3 py-2 font-mono text-[length:var(--text-dense)] text-[var(--ink)]"
					>
						{status.url}
					</p>
					<Button size="dense" onClick={() => void copy(status.url, "URL copied.")}>
						<Icon name="copy" />
						Copy URL
					</Button>
				</div>
				<p className="mt-2 max-w-[68ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Paste this into any client that takes an MCP server URL. Juno has to be running and unlocked.
				</p>

				<PortRow status={status} busy={switching} onChange={(port) => void run(() => window.juno.agent.server.setPort(port))} />
			</section>

			<section data-setting="mcp-clients" className="mt-10 border-t border-[var(--line-strong)] pt-8 first:mt-0 first:border-t-0 first:pt-0">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Connected clients</h2>
				<ConnectedClients onNotice={onNotice} />
			</section>

			<section data-setting="mcp-connect" className="mt-10 border-t border-[var(--line-strong)] pt-8 first:mt-0 first:border-t-0 first:pt-0">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Connect a client</h2>
					<RouteSwitch route={route} onChange={setRoute} />
				</div>

				<div className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--sunken)] px-3 py-2.5">
					<Icon name="info" className="mt-0.5 flex-none text-[var(--ink-muted)]" />
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						The first time a client connects it opens a page with a code. Type that code into the prompt
						Juno shows. Claude Desktop only takes servers on the internet, so it cannot use this address.
					</p>
				</div>

				<div className="mt-4">
					{route === "install" ? (
						<ClientInstaller onNotice={onNotice} serverRunning={status.running} />
					) : (
						<ManualSetup onNotice={onNotice} />
					)}
				</div>
			</section>

			<section data-setting="mcp-tools" className="mt-10 border-t border-[var(--line-strong)] pt-8 first:mt-0 first:border-t-0 first:pt-0">
				<div className="flex items-baseline justify-between gap-4">
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

type PortRowProps = {
	status: McpServerStatus;
	busy: boolean;
	/** A port, or null for the default. */
	onChange: (port: number | null) => void;
};

/**
 * The port is a small thing most people never touch, so it is one quiet line
 * rather than a form. Changing it moves the URL, and every client already
 * pointed at the old one has to be pointed again, which the line says.
 */
function PortRow({ status, busy, onChange }: PortRowProps) {
	const [draft, setDraft] = useState(String(status.port));

	const parsed = Number(draft);
	const valid = Number.isInteger(parsed) && parsed >= 1024 && parsed <= 32767;
	const changed = valid && parsed !== status.port;
	const custom = status.port !== status.defaultPort;

	return (
		<div className="mt-5">
			<div className="flex flex-wrap items-end gap-2">
				<label className="block">
					<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Port</span>
					<input
						type="number"
						inputMode="numeric"
						min={1024}
						max={32767}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						className="tabular w-[110px] rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
					/>
				</label>
				<Button size="dense" disabled={busy || !changed} onClick={() => onChange(parsed)}>
					Change port
				</Button>
				{custom ? (
					<Button
						size="dense"
						disabled={busy}
						onClick={() => {
							setDraft(String(status.defaultPort));
							onChange(null);
						}}
					>
						Use {status.defaultPort}
					</Button>
				) : null}
			</div>
			<p className="mt-2 max-w-[68ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{draft !== "" && !valid
					? "Pick a port from 1024 to 32767. Higher ones are handed out to other programs at random."
					: "Changing the port changes the URL, so clients have to be pointed at it again."}
			</p>
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
