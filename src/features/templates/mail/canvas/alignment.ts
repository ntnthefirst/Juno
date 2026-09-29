/**
 * Figma's 3 by 3 alignment box, read from and written to the model a container
 * can hold.
 *
 * The box is two questions asked at once: where along the page the content
 * sits (left, centre, right) and where down it (top, middle, bottom). The
 * model asks them the way CSS does, along the flow and across it, so which of
 * its fields answers which depends on the way the container runs:
 *
 * | Container runs | Left, centre, right | Top, middle, bottom |
 * | --- | --- | --- |
 * | Across (row) | `justify` | `align` |
 * | Down (column) | `align` | `justify` |
 * | Grid | `justify` (justify-items) | `align` (align-items) |
 *
 * Four values do not fit the box and stay reachable: `stretch` on either axis
 * (a toggle beside the box), and `between` and `around` along the flow of a
 * flex container (the gap's Auto). Reading them never changes them, and a
 * click on the box leaves the space-between ones alone, the way Figma's box
 * does while the gap is Auto.
 */
import type { MailAlign, MailJustify, MailSectionLayout } from "@shared/types";

/** The three places along an axis. */
export type Spot = 0 | 1 | 2;

/** The page's two axes, as the box draws them. */
export type Axis = "horizontal" | "vertical";

/** Every value either axis can hold: what the box can show, and the ones it cannot. */
export type AxisValue = MailAlign | MailJustify;

export type Axes = { horizontal: AxisValue; vertical: AxisValue };

const SPOT_OF: Partial<Record<AxisValue, Spot>> = { start: 0, center: 1, end: 2 };
const VALUE_OF: Record<Spot, "start" | "center" | "end"> = { 0: "start", 1: "center", 2: "end" };

/** Where a value sits in the box, or null for one the box cannot draw. */
export function spotOf(value: AxisValue): Spot | null {
	return SPOT_OF[value] ?? null;
}

/** What each of the page's axes is set to, whichever field holds it. */
export function axesOf(layout: MailSectionLayout): Axes {
	if (layout.kind === "grid") return { horizontal: layout.justify, vertical: layout.align };
	return layout.direction === "row"
		? { horizontal: layout.justify, vertical: layout.align }
		: { horizontal: layout.align, vertical: layout.justify };
}

/** The layout with one axis set to a value the field behind it can hold. */
function withAxis(layout: MailSectionLayout, axis: Axis, value: AxisValue): MailSectionLayout {
	if (layout.kind === "grid") {
		const align: MailAlign = value === "between" || value === "around" ? "start" : value;
		return axis === "horizontal" ? { ...layout, justify: align } : { ...layout, align };
	}
	const along = (layout.direction === "row") === (axis === "horizontal");
	if (along) return { ...layout, justify: value === "stretch" ? "start" : value };
	return { ...layout, align: value === "between" || value === "around" ? "start" : value };
}

/**
 * A click on the box: the content goes to that place. Along the flow of a flex
 * container that is space-between or space-around, only the other axis
 * changes, so the gap stays Auto.
 */
export function place(layout: MailSectionLayout, column: Spot, row: Spot): MailSectionLayout {
	const axes = axesOf(layout);
	const keeps = (value: AxisValue) => value === "between" || value === "around";
	let next = layout;
	if (!keeps(axes.horizontal)) next = withAxis(next, "horizontal", VALUE_OF[column]);
	if (!keeps(axes.vertical)) next = withAxis(next, "vertical", VALUE_OF[row]);
	return next;
}

/** The axes that can be stretched: the way across a flex container, both ways in a grid. */
export function stretchAxes(layout: MailSectionLayout): Axis[] {
	if (layout.kind === "grid") return ["horizontal", "vertical"];
	return layout.direction === "row" ? ["vertical"] : ["horizontal"];
}

export function isStretched(layout: MailSectionLayout, axis: Axis): boolean {
	return axesOf(layout)[axis] === "stretch";
}

/** Stretch on or off for one axis. Off goes to the start, the value a click on the box's first place would have set. */
export function setStretch(layout: MailSectionLayout, axis: Axis, on: boolean): MailSectionLayout {
	if (!stretchAxes(layout).includes(axis)) return layout;
	return withAxis(layout, axis, on ? "stretch" : "start");
}

/** Space between or around along the flow of a flex container, or null when the content is packed. */
export function spreadOf(layout: MailSectionLayout): "between" | "around" | null {
	if (layout.kind !== "flex") return null;
	return layout.justify === "between" || layout.justify === "around" ? layout.justify : null;
}

/** Sets or lifts the spread. Lifting it packs the content at the start. */
export function setSpread(layout: MailSectionLayout, spread: "between" | "around" | null): MailSectionLayout {
	if (layout.kind !== "flex") return layout;
	if (spread === null) return layout.justify === "between" || layout.justify === "around" ? { ...layout, justify: "start" } : layout;
	return { ...layout, justify: spread };
}

/** How strongly one place of the box is lit: it is the value, it is on the line the value picks, or not at all. */
export type Lit = "on" | "line" | "off";

/**
 * The state of the box's place at `column` and `row`. A stretched axis has no
 * place of its own, so the other axis lights the whole line it picks; a spread
 * axis does the same. Both spread and stretched, which only a grid can be
 * beside a stretch, lights nothing.
 */
export function litAt(layout: MailSectionLayout, column: Spot, row: Spot): Lit {
	const axes = axesOf(layout);
	const across = spotOf(axes.horizontal);
	const down = spotOf(axes.vertical);
	if (across !== null && down !== null) return across === column && down === row ? "on" : "off";
	if (across !== null) return across === column ? "line" : "off";
	if (down !== null) return down === row ? "line" : "off";
	return "off";
}

/** The three ways a container can lay out what is in it, as the panel's Flow row names them. */
export type LayoutFlow = "down" | "across" | "grid";

export function flowNameOf(layout: MailSectionLayout): LayoutFlow {
	if (layout.kind === "grid") return "grid";
	return layout.direction === "row" ? "across" : "down";
}

/** Between and around are along-the-flow values; anywhere else they are the start. */
function packed(value: AxisValue): MailAlign {
	return value === "between" || value === "around" ? "start" : value;
}

/**
 * The layout with another flow, keeping where the content sits on the page.
 * Between a column and a row nothing else changes, which is what the row has
 * always done; to and from a grid the places on the page are carried over, so
 * the content does not jump.
 */
export function withFlow(layout: MailSectionLayout, flow: LayoutFlow): MailSectionLayout {
	if (flowNameOf(layout) === flow) return layout;
	if (flow === "grid") {
		const axes = axesOf(layout);
		return { kind: "grid", columns: 2, gap: layout.gap, align: packed(axes.vertical), justify: packed(axes.horizontal) };
	}
	const direction = flow === "across" ? "row" : "column";
	if (layout.kind === "flex") return { ...layout, direction };
	const axes = axesOf(layout);
	const [along, across] = direction === "row" ? [axes.horizontal, axes.vertical] : [axes.vertical, axes.horizontal];
	return {
		kind: "flex",
		direction,
		justify: along === "stretch" ? "start" : along,
		align: packed(across),
		gap: layout.gap,
		wrap: false,
	};
}
