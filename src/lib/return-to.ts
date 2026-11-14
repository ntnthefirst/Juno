import type { ScreenId } from "../app/screens";
import type { OpenTarget } from "./open-entity";

/**
 * Where a document's preview came from, held by the shell while the preview
 * is open over that screen. The screen is not unmounted, only hidden, so its
 * tab and its rows are as they were; what hiding loses is the scroll and the
 * focus, and those are kept here and put back on return.
 */
export type CameFrom<E> = {
	/** The screen under the preview, the one the close goes back to. */
	screen: ScreenId;
	/** What the way back is called: the record open there, or the screen's name. */
	label: string;
	/** The element to focus on return: the row or button the preview was opened from. */
	focus: E | null;
	scroll: ScrollMark<E>[];
};

type Scrollable = { scrollTop: number; scrollLeft: number };

export type ScrollMark<E> = { element: E; top: number; left: number };

/**
 * The screen a request should open over rather than replace, or null when it
 * lands the way it always has. Only a document is previewed over where it was
 * asked for, since a document has no screen of its own (decision 81); every
 * other kind of request is a place of its own.
 */
export function coverOrigin(target: OpenTarget, shown: ScreenId): ScreenId | null {
	return target.kind === "document" ? shown : null;
}

/** Every element that is scrolled away from its start, with how far. */
export function markScroll<E extends Scrollable>(elements: Iterable<E>): ScrollMark<E>[] {
	const marks: ScrollMark<E>[] = [];
	for (const element of elements) {
		if (element.scrollTop !== 0 || element.scrollLeft !== 0) marks.push({ element, top: element.scrollTop, left: element.scrollLeft });
	}
	return marks;
}

/** Puts each element back where it was scrolled to. */
export function restoreScroll<E extends Scrollable>(marks: readonly ScrollMark<E>[]): void {
	for (const mark of marks) {
		mark.element.scrollTop = mark.top;
		mark.element.scrollLeft = mark.left;
	}
}

/**
 * What to focus on return. The element focused when the request was made,
 * when it was on that screen; otherwise the last one focused there, because a
 * request from the palette, Recent or a title bar menu is made with the focus
 * in something that closes as it asks.
 */
export function focusToReturn<E>(active: E | null, lastInside: E | null, isInside: (element: E) => boolean): E | null {
	if (active !== null && isInside(active)) return active;
	if (lastInside !== null && isInside(lastInside)) return lastInside;
	return null;
}
