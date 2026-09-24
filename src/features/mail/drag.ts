/**
 * Dragging threads onto a folder.
 *
 * The payload is a private type rather than `text/plain`, so a drag from
 * somewhere else in the window cannot look like a thread, and a thread cannot
 * be dropped into a text field as a line of JSON. `types` carries it during the
 * drag while `getData` is empty, which is what a drop target checks to know
 * whether to light up.
 */
export const THREAD_DRAG_TYPE = "application/x-juno-mail-threads";

/**
 * The drag image, made rather than borrowed.
 *
 * Left alone, the browser drags a snapshot of the element the drag started on,
 * and inside a list that reads as dragging the whole list: the ghost is as wide
 * as the pane and shows its neighbours. A small chip saying what is being
 * carried is both honest and legible, and it is the only way to show that a drag
 * of a selection is carrying five things rather than the one under the cursor.
 *
 * It has to be in the document to be rendered into the drag image, so it is
 * placed off screen and removed on the next frame, once the browser has taken
 * its picture.
 */
function dragChip(label: string): HTMLElement {
	const chip = document.createElement("div");
	chip.textContent = label;
	chip.style.position = "fixed";
	chip.style.top = "-1000px";
	chip.style.left = "-1000px";
	chip.style.padding = "6px 10px";
	chip.style.borderRadius = "var(--radius-md)";
	chip.style.background = "var(--accent)";
	chip.style.color = "var(--accent-ink)";
	chip.style.font = "var(--weight-medium) 13px var(--font-sans)";
	chip.style.whiteSpace = "nowrap";
	chip.style.maxWidth = "280px";
	chip.style.overflow = "hidden";
	chip.style.textOverflow = "ellipsis";
	chip.style.pointerEvents = "none";
	document.body.appendChild(chip);
	return chip;
}

export function startThreadDrag(event: React.DragEvent, threadIds: string[], oneLabel: string): void {
	event.dataTransfer.setData(THREAD_DRAG_TYPE, JSON.stringify(threadIds));
	event.dataTransfer.effectAllowed = "move";
	const chip = dragChip(threadIds.length === 1 ? oneLabel : `${threadIds.length} threads`);
	event.dataTransfer.setDragImage(chip, 12, 12);
	requestAnimationFrame(() => chip.remove());
}
