import { useEffect, useState } from "react";
import type { ClientSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";
import { importFiles, type ImportOutcome } from "../../lib/pdf-drop";

type DropImportDialogProps = {
	files: File[];
	onClose: () => void;
	/** Called once the import has run, so a screen showing documents can reload. */
	onImported: () => void;
};

/**
 * What a drop anywhere but a client's own documents tab asks: which client the
 * files belong to. Everything after that is the same import a picker does, so
 * a name the client already has is refused in the same words.
 */
export function DropImportDialog({ files, onClose, onImported }: DropImportDialogProps) {
	const [clients, setClients] = useState<ClientSummary[]>([]);
	const [clientId, setClientId] = useState("");
	const [clientError, setClientError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
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

	async function run() {
		if (busy) return;
		setClientError(clientId.length === 0 ? "Choose a client." : null);
		if (clientId.length === 0) return;
		setError(null);
		setBusy(true);
		try {
			const result = await importFiles(clientId, files);
			setOutcome(result);
			if (result.imported.length > 0) onImported();
			if (result.failures.length === 0) onClose();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const failed = outcome?.failures ?? [];

	return (
		<Dialog title={files.length === 1 ? "Import a PDF" : `Import ${files.length} files`} width="narrow" onClose={onClose}>
			<ul className="mt-3 max-h-[120px] overflow-y-auto text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{files.map((file, index) => (
					<li key={`${file.name}:${index}`} data-selectable className="truncate">
						{file.name}
					</li>
				))}
			</ul>

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
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not import.</p>
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{error}
					</p>
				</div>
			) : null}

			{failed.length > 0 ? (
				<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">
						{outcome && outcome.imported.length > 0
							? `${outcome.imported.length} imported, ${failed.length} not.`
							: "Nothing was imported."}
					</p>
					<ul className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{failed.map((entry, index) => (
							<li key={`${entry.name}:${index}`} data-selectable>
								{entry.message}
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="mt-6 flex justify-end gap-2">
				<Button onClick={onClose}>{outcome ? "Close" : "Cancel"}</Button>
				{outcome ? null : (
					<Button variant="primary" disabled={busy} onClick={() => void run()}>
						{busy ? "Importing" : "Import"}
					</Button>
				)}
			</div>
		</Dialog>
	);
}
