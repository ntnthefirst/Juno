import { useEffect, useState } from "react";
import type { ClientSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type LinkClientDialogProps = {
	threadId: string;
	currentClientId: string | null;
	onClose: () => void;
	onLinked: () => void;
};

export function LinkClientDialog({ threadId, currentClientId, onClose, onLinked }: LinkClientDialogProps) {
	const [search, setSearch] = useState("");
	const [clients, setClients] = useState<ClientSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const id = setTimeout(() => {
			window.bureau.clients
				.list({ search: search.trim() || undefined, limit: 50 })
				.then((rows) => {
					if (!cancelled) setClients(rows);
				})
				.catch((cause: unknown) => {
					if (!cancelled) setError(messageOf(cause));
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [search]);

	async function link(clientId: string) {
		setBusy(true);
		try {
			await window.bureau.mail.threads.linkClient(threadId, clientId);
			onLinked();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<Dialog title="Link to client" onClose={onClose} width="narrow">
			<input
				type="search"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				placeholder="Search clients"
				aria-label="Search clients"
				className="mt-4 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
			/>
			{error ? (
				<p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}
			<ul className="mt-3 max-h-[320px] overflow-y-auto">
				{clients === null ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">Loading.</li>
				) : clients.length === 0 ? (
					<li className="px-3 py-2 text-[var(--ink-muted)]">No clients match.</li>
				) : (
					clients.map((client) => (
						<li key={client.id}>
							<button
								type="button"
								disabled={busy}
								onClick={() => void link(client.id)}
								style={{ height: "var(--row-height)" }}
								className={[
									"flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 text-left hover:bg-[var(--hover)]",
									client.id === currentClientId ? "text-[var(--accent)]" : "",
								].join(" ")}
							>
								<span className="truncate">{client.name}</span>
								{client.city ? (
									<span className="shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{client.city}
									</span>
								) : null}
							</button>
						</li>
					))
				)}
			</ul>
			<div className="mt-4 flex justify-end">
				<Button onClick={onClose}>Cancel</Button>
			</div>
		</Dialog>
	);
}
