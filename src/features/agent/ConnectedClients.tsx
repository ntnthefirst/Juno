import { useCallback, useEffect, useState } from "react";
import type { AgentConnection, AgentTokenCreated } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";

type ConnectedClientsProps = {
	onNotice: (message: string) => void;
};

/** A date a person reads, from an instant. */
function day(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
}

function lastUsed(connection: AgentConnection): string {
	if (!connection.lastUsedAt) return "never used";
	const at = new Date(connection.lastUsedAt);
	if (Number.isNaN(at.getTime())) return "used";
	const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
	if (minutes < 1) return "used just now";
	if (minutes < 60) return `used ${minutes} min ago`;
	if (minutes < 60 * 24) return `used ${Math.round(minutes / 60)} h ago`;
	return `used ${day(connection.lastUsedAt)}`;
}

/**
 * Who has been let in, and the way to take one out again.
 *
 * A client that cannot do the handshake gets a token made here instead. It is
 * shown once, when it is made, because only a hash of it is kept.
 */
export function ConnectedClients({ onNotice }: ConnectedClientsProps) {
	const [rows, setRows] = useState<AgentConnection[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState("");
	const [created, setCreated] = useState<AgentTokenCreated | null>(null);
	const [busy, setBusy] = useState(false);

	const reload = useCallback(() => {
		window.juno.agent.connections
			.list()
			.then((list) => {
				setRows(list);
				setError(null);
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(() => {
		reload();
		// A client lets itself in while this is open, and has to appear.
		return window.juno.agent.connections.onChange(reload);
	}, [reload]);

	async function revoke(connection: AgentConnection) {
		try {
			await window.juno.agent.connections.revoke(connection.id);
			onNotice(`${connection.name} removed.`);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			reload();
		}
	}

	async function makeToken() {
		setBusy(true);
		try {
			const made = await window.juno.agent.connections.createToken(name.trim() || "Access token");
			setCreated(made);
			setNaming(false);
			setName("");
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function copyToken(token: string) {
		try {
			await navigator.clipboard.writeText(token);
			onNotice("Token copied.");
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	if (error) {
		return (
			<p role="alert" data-selectable className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
				{error}
			</p>
		);
	}
	if (rows === null) return <p className="mt-3 text-[var(--ink-muted)]">Loading.</p>;

	return (
		<div>
			{rows.length === 0 ? (
				<p className="mt-3 max-w-[68ch] text-[var(--ink-muted)]">
					No client has been let in yet. Point one at the URL above and Juno asks you for a code.
				</p>
			) : (
				<ul className="mt-3">
					{rows.map((connection) => (
						<li key={connection.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-2">
							<span className="min-w-0 flex-1">
								<span className="flex flex-wrap items-center gap-2">
									<span className="font-[var(--weight-medium)]">{connection.name}</span>
									<span className="rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										{connection.kind === "token" ? "access token" : "signed in with a code"}
									</span>
								</span>
								<span className="tabular mt-0.5 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									Added {day(connection.createdAt)}, {lastUsed(connection)}
								</span>
							</span>
							<Button size="dense" variant="danger" onClick={() => void revoke(connection)}>
								Remove
							</Button>
						</li>
					))}
				</ul>
			)}

			{created ? (
				<div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4">
					<p className="font-[var(--weight-medium)]">Token for {created.connection.name}</p>
					<div className="mt-2 flex items-center gap-2">
						<p
							data-selectable
							className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-[var(--sunken)] px-3 py-2 font-mono text-[length:var(--text-sm)] text-[var(--ink)]"
						>
							{created.token}
						</p>
						<Button size="dense" onClick={() => void copyToken(created.token)}>
							<Icon name="copy" />
							Copy
						</Button>
					</div>
					<p className="mt-2 max-w-[68ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Send it as an Authorization header: Bearer followed by the token. It is not shown again.
					</p>
					<div className="mt-3">
						<Button size="dense" onClick={() => setCreated(null)}>
							Done
						</Button>
					</div>
				</div>
			) : naming ? (
				<form
					className="mt-4 flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void makeToken();
					}}
				>
					<label className="block">
						<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Name</span>
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="My script"
							autoFocus
							maxLength={60}
							className="w-[220px] rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
						/>
					</label>
					<Button type="submit" size="dense" variant="primary" disabled={busy}>
						Create
					</Button>
					<Button size="dense" onClick={() => setNaming(false)}>
						Cancel
					</Button>
				</form>
			) : (
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<Button size="dense" onClick={() => setNaming(true)}>
						<Icon name="add" />
						Create an access token
					</Button>
					<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						For a client that cannot show a code.
					</span>
				</div>
			)}
		</div>
	);
}
