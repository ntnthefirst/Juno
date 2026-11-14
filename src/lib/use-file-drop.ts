import { useState, type DragEvent } from "react";
import { isOwnDrag, ownDrop } from "./document-drag";
import { carriesFiles } from "./pdf-drop";

type FileDrop = {
	/** True while files are being dragged over the element. */
	dragging: boolean;
	/** Spread onto the element that accepts the drop. */
	bind: {
		onDragEnter: (event: DragEvent<HTMLElement>) => void;
		onDragOver: (event: DragEvent<HTMLElement>) => void;
		onDragLeave: (event: DragEvent<HTMLElement>) => void;
		onDrop: (event: DragEvent<HTMLElement>) => void;
	};
};

/**
 * A drop target for files. The handlers mark the event as handled, which is how
 * the window-wide drop layer knows to stay out of the way.
 *
 * A document dragged out of Juno comes back as files too (lib/document-drag.ts).
 * It is taken only where `acceptOwn` says so, as the composer does to attach
 * it; anywhere else it is let go of without adding the file a second time.
 */
export function useFileDrop(onFiles: (files: File[]) => void, options: { acceptOwn?: boolean } = {}): FileDrop {
	const [dragging, setDragging] = useState(false);

	function accept(event: DragEvent<HTMLElement>) {
		if (!carriesFiles(event)) return false;
		event.preventDefault();
		return true;
	}

	return {
		dragging,
		bind: {
			onDragEnter(event) {
				if (accept(event) && (options.acceptOwn === true || !isOwnDrag())) setDragging(true);
			},
			onDragOver(event) {
				if (accept(event)) event.dataTransfer.dropEffect = "copy";
			},
			onDragLeave(event) {
				// Moving onto a child fires leave on the parent, which is not leaving.
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
				setDragging(false);
			},
			onDrop(event) {
				if (!accept(event)) return;
				setDragging(false);
				const files = Array.from(event.dataTransfer.files);
				if (options.acceptOwn !== true && ownDrop(files)) return;
				if (files.length > 0) onFiles(files);
			},
		},
	};
}
