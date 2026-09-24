import { useEffect, useState } from "react";
import type { ClientEmail, ClientSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type LinkClientDialogProps = {
	threadId: string;
	currentClientId: string | null;
	/** The correspondent's address, if one is known, offered for "also add" below. */
	senderAddress: string | null;
	onClose: () => void;
	onLinked: () => void;
};

/**
 * Linking and adding an address are two different things, and this asks for
 * each on its own: linking only files the conversation under a client, it
 * does not teach Juno the address. Adding the address is what makes the next
 * message from it match automatically, so the choice is offered, not implied.
 */
export function LinkClientDialog({ threadId, currentClientId, senderAddress, onClose, onLinked }: LinkClientDialogProps) {
	const [search, setSearch] = useState("");
	const [clients, setClients] = useState<ClientSummary[] | null>(null);
	const [chosen, setChosen] = useState<ClientSummary | null>(null);
	// Keyed by client id rather than reset to null on the way out, so the effect
	// never has to call setState synchronously just to clear a stale value.
	const [chosenEmails, setChosenEmails] = useState<{ clientId: string; rows: ClientEmail[] } | null>(null);
	const [addAddress, setAddAddress] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (chosen) return;
		let cancelled = false;
		const id = setTimeout(() => {
			window.juno.clients
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
	}, [search, chosen]);

	useEffect(() => {
		if (!chosen) return;
		let cancelled = false;
		window.juno.clientEmails
			.listForClient(chosen.id)
			.then((rows) => {
				if (!cancelled) setChosenEmails({ clientId: chosen.id, rows });
			})
			.catch(() => {
				if (!cancelled) setChosenEmails({ clientId: chosen.id, rows: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [chosen]);

	const chosenEmailRows = chosen && chosenEmails?.clientId === chosen.id ? chosenEmails.rows : [];
	const alreadyOnClient =
		senderAddress !== null && chosenEmailRows.some((e) => e.email.toLowerCase() === senderAddress.toLowerCase());

	function choose(client: ClientSummary) {
		setChosen(client);
		setAddAddress(true);
		setError(null);
	}

	async function confirmLink() {
		if (!chosen) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.mail.threads.linkClient(threadId, chosen.id);
			if (senderAddress && !alreadyOnClient && addAddress) {
				await window.juno.clientEmails.create({ clientId: chosen.id, email: senderAddress, label: null });
			}
			onLinked();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	if (chosen) {
		return (
			<Dialog title="Link to client" onClose={onClose} width="narrow">
				<p className="mt-4 text-[var(--ink-muted)]">
					Link this conversation to{" "}
					<span className="font-[var(--weight-medium)] text-[var(--ink)]">{chosen.name}</span>? This files the
					conversation under the client. It does not change which address Juno matches automatically.
				</p>
				{senderAddress && !alreadyOnClient ? (
					<label className="mt-3 flex cursor-pointer items-start gap-2">
						<input
							type="checkbox"
							checked={addAddress}
							onChange={(event) => setAddAddress(event.target.checked)}
							className="mt-0.5 accent-[var(--accent)]"
						/>
						<span className="text-[length:var(--text-sm)] text-[var(--ink)]">
							Also add {senderAddress} to {chosen.name}. That is what makes future mail from this address
							match automatically.
						</span>
					</label>
				) : null}
				{error ? (
					<p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						{error}
					</p>
				) : null}
				<div className="mt-4 flex justify-end gap-2">
					<Button disabled={busy} onClick={() => setChosen(null)}>
						Back
					</Button>
					<Button variant="primary" disabled={busy} onClick={() => void confirmLink()}>
						Link
					</Button>
				</div>
			</Dialog>
		);
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
								onClick={() => choose(client)}
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
