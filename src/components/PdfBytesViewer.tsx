import { useCallback, type ReactNode } from "react";
import { PdfViewer } from "./PdfViewer";

type PdfBytesViewerProps = {
	/** Names the file, so a different PDF of the same size is still opened again. */
	name: string;
	data: Uint8Array;
	caption?: ReactNode;
};

/** The PDF viewer for bytes already in hand: its read hands them straight back. */
export function PdfBytesViewer({ name, data, caption }: PdfBytesViewerProps) {
	const read = useCallback(async () => data, [data]);
	return (
		<PdfViewer
			fileKey={`${name}:${data.byteLength}`}
			read={read}
			caption={caption}
			empty={<p className="text-[var(--ink-muted)]">This PDF is empty.</p>}
		/>
	);
}
