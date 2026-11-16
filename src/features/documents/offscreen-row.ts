import type { CSSProperties } from "react";

/**
 * A row the browser lays out and paints only when it is near the view, held
 * at the row height until then. A tree and a folder of five hundred clients
 * each are a thousand rows, and laying them all out held Documents for half a
 * second before its first frame. The rows draw their focus ring inside, so
 * the paint containment this brings clips nothing.
 */
export const OFFSCREEN_ROW: CSSProperties = {
	contentVisibility: "auto",
	containIntrinsicSize: "auto var(--row-height)",
};
