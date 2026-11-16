import { useState, type ReactNode } from "react";
import type { FilePreviewSource } from "@shared/types";
import { useFilePreview } from "../lib/use-file-preview";
import { FilePreviewView } from "./FilePreviewView";
import { FullPreview } from "./FullPreview";

/** One file the quick look can show: a mail attachment, a project's file, anything the main process can preview. */
export type QuickLookFile = {
	key: string;
	name: string;
	/** Type, size and date, in one line. */
	meta: string;
	source: FilePreviewSource;
};

type FileQuickLookProps = {
	files: QuickLookFile[];
	index: number;
	onIndex: (index: number) => void;
	onClose: () => void;
	closeLabel?: string;
	/** Opens the file in its own app. Left out where that is not allowed, such as an untrusted sender's attachment. */
	onOpen?: (file: QuickLookFile) => void;
	/** The file's own actions in the header. */
	actions?: (file: QuickLookFile) => ReactNode;
	/** A column at the right, such as where to keep a mail attachment. */
	column?: (file: QuickLookFile) => ReactNode;
};

/**
 * The full preview for a file that is not a document yet: an attachment in
 * the mail reader, a file of a project. The same frame the explorer uses, so
 * a click on a file looks the same wherever the file is (decision 75).
 */
export function FileQuickLook({ files, index, onIndex, onClose, closeLabel, onOpen, actions, column }: FileQuickLookProps) {
	const file = files[Math.min(Math.max(0, index), files.length - 1)];
	const state = useFilePreview(file ? file.source : null);
	const [columnOpen, setColumnOpen] = useState(true);
	if (!file) return null;
	const at = files.indexOf(file);
	return (
		<FullPreview
			title={file.name}
			meta={file.meta}
			closeLabel={closeLabel}
			onClose={onClose}
			position={
				files.length > 1
					? {
							index: at,
							total: files.length,
							onPrevious: () => onIndex(Math.max(0, at - 1)),
							onNext: () => onIndex(Math.min(files.length - 1, at + 1)),
						}
					: null
			}
			actions={actions?.(file)}
			column={column?.(file)}
			columnOpen={columnOpen}
			onToggleColumn={() => setColumnOpen((open) => !open)}
		>
			<FilePreviewView state={state} {...(onOpen ? { onOpen: () => onOpen(file) } : {})} />
		</FullPreview>
	);
}
