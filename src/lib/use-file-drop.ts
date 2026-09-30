import { useState, type DragEvent } from "react";
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
 */
export function useFileDrop(onFiles: (files: File[]) => void): FileDrop {
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
				if (accept(event)) setDragging(true);
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
				if (files.length > 0) onFiles(files);
			},
		},
	};
}
