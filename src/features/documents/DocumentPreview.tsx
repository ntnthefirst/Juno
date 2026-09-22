import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type DocumentPreviewProps = {
	documentId: string;
	title: string;
	isSpecimen: boolean;
	onClose: () => void;
};

export function DocumentPreview({ documentId, title, isSpecimen, onClose }: DocumentPreviewProps) {
	const [html, setHtml] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.documents
			.previewHtml(documentId)
			.then((value) => {
				if (!cancelled) setHtml(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [documentId]);

	return (
		<Dialog title={title} onClose={onClose} width="wide">
			{isSpecimen ? (
				<p className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					Specimen. This came from a template nobody has checked, so it is not fit to send.
				</p>
			) : null}

			{error ? (
				<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">
						Could not render this document.
					</p>
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{error}
					</p>
				</div>
			) : html === null ? (
				<p className="mt-4 text-[var(--ink-muted)]">Loading.</p>
			) : (
				/* The body is the operator's own template, but it quotes client data, so
				   the frame gets no privileges at all: no scripts, no navigation. */
				<iframe
					title={`${title}, rendered`}
					sandbox=""
					srcDoc={html}
					className="mt-4 h-[62vh] w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]"
				/>
			)}

			<div className="mt-6 flex justify-end">
				<Button onClick={onClose}>Close</Button>
			</div>
		</Dialog>
	);
}
