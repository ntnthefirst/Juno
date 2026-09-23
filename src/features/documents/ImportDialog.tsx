import { useEffect, useState } from "react";
import type { ClientSummary, DocumentRecord } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type ImportDialogProps = {
	onClose: () => void;
	onImported: (record: DocumentRecord) => void;
};

/**
 * A document belongs to a client, so that is the one question this asks
 * before handing off to the native file picker. Cancelling the picker closes
 * nothing here: the person is back at this same choice, not bounced out.
 */
export function ImportDialog({ onClose, onImported }: ImportDialogProps) {
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [clientId, setClientId] = useState("");
	const [clientError, setClientError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.clients
			.list()
			.then((rows) => {
				if (!cancelled) setClients(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function choosePdf() {
		if (busy) return;
		setClientError(clientId.length === 0 ? "Choose a client." : null);
		if (clientId.length === 0) return;

		setError(null);
		setBusy(true);
		try {
			const record = await window.juno.documents.chooseImport(clientId);
			// A cancelled file dialog returns null and does nothing, not an error.
			if (record) {
				onImported(record);
			} else {
				setBusy(false);
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<Dialog title="Import a PDF" width="narrow" onClose={onClose}>
			<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Choose the client this document belongs to, then pick the PDF to copy in.
			</p>

			<div className="mt-4">
				<Select
					label="Client"
					required
					value={clientId}
					onChange={(value) => {
						setClientId(value);
						setClientError(null);
					}}
					placeholder="Choose a client"
					error={clientError}
					options={clients.map((row) => ({ value: row.id, label: row.name }))}
				/>
			</div>

			{error ? (
				<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">
						Could not import this document.
					</p>
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{error}
					</p>
				</div>
			) : null}

			<div className="mt-6 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="primary" disabled={busy} onClick={() => void choosePdf()}>
					{busy ? "Choosing" : "Choose a PDF"}
				</Button>
			</div>
		</Dialog>
	);
}
