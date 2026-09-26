import { useState } from "react";
import type { MailFill } from "@shared/types";
import { solidFill } from "./canvas-actions";
import { opacityPercent, parseHex, withOpacity } from "./color";
import { ColorArea } from "./ColorPicker";
import { ColorRow } from "./ColorRow";
import { NumberInput, PanelButton, PanelNote, PanelSection, Segmented } from "./panel-controls";

type FillSectionProps = {
	fill: MailFill | null;
	onFill: (fill: MailFill | null) => void;
};

type GradientStopsProps = {
	fill: Extract<MailFill, { kind: "gradient" }>;
	active: "from" | "to";
	onActive: (stop: "from" | "to") => void;
};

const CHECKERS = "repeating-conic-gradient(var(--line) 0 25%, var(--surface) 0 50%) 0 0 / 8px 8px";

/** The gradient as a bar with its two stops on it, the way Figma edits one. */
function GradientStops({ fill, active, onActive }: GradientStopsProps) {
	const stop = (which: "from" | "to") => (
		<button
			type="button"
			aria-label={which === "from" ? "Start colour" : "End colour"}
			title={which === "from" ? "Start colour" : "End colour"}
			aria-pressed={active === which}
			onClick={() => onActive(which)}
			style={{ background: `linear-gradient(${fill[which]}, ${fill[which]}), ${CHECKERS}` }}
			className={`h-[18px] w-[18px] flex-none rounded-full border-2 shadow-[var(--shadow-popover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
				active === which ? "border-[var(--accent)]" : "border-[var(--surface)]"
			}`}
		/>
	);
	return (
		<div
			style={{ background: `linear-gradient(to right, ${fill.from}, ${fill.to}), ${CHECKERS}` }}
			className="flex h-[24px] items-center justify-between rounded-[var(--radius-sm)] px-1"
		>
			{stop("from")}
			{stop("to")}
		</div>
	);
}

type PaintRowProps = { fill: MailFill; onFill: (fill: MailFill) => void };

/**
 * The fill as a row: a colour shows its hex and its opacity, a gradient its
 * name and one opacity for the whole of it. The picker switches between the
 * two and edits whichever stop is chosen.
 */
function PaintRow({ fill, onFill }: PaintRowProps) {
	const [stop, setStop] = useState<"from" | "to">("from");
	const first = fill.kind === "solid" ? fill.color : fill.from;

	const picker = (
		<>
			<Segmented
				label="Fill type"
				value={fill.kind}
				options={[
					{ value: "solid", label: "Solid", icon: "fill-solid", title: "Solid" },
					{ value: "gradient", label: "Linear", icon: "fill-gradient", title: "Linear gradient" },
				]}
				onChange={(kind) =>
					onFill(
						kind === "solid"
							? { ...solidFill(first), hidden: fill.hidden }
							: { kind: "gradient", angle: 180, from: first, to: "#ffffff", hidden: fill.hidden },
					)
				}
			/>
			{fill.kind === "gradient" ? (
				<>
					<GradientStops fill={fill} active={stop} onActive={setStop} />
					<NumberInput
						label="Angle in degrees"
						prefix="deg"
						value={fill.angle}
						min={0}
						max={360}
						onChange={(angle) => onFill({ ...fill, angle })}
					/>
					<ColorArea
						value={fill[stop]}
						onChange={(color) => onFill(stop === "from" ? { ...fill, from: color } : { ...fill, to: color })}
					/>
				</>
			) : (
				<ColorArea value={fill.color} onChange={(color) => onFill({ ...fill, color })} />
			)}
		</>
	);

	if (fill.kind === "solid") {
		return <ColorRow label="Fill" value={fill.color} onChange={(color) => onFill({ ...fill, color })} picker={picker} />;
	}
	return (
		<ColorRow
			label="Fill"
			value={fill.from}
			onChange={(from) => onFill({ ...fill, from })}
			paint={{
				swatch: `linear-gradient(${fill.angle}deg, ${fill.from}, ${fill.to})`,
				name: "Linear",
				opacity: opacityPercent(fill.from),
				// One opacity for the whole gradient, the way Figma's paint has one.
				onOpacity: (percent) => onFill({ ...fill, from: withOpacity(fill.from, percent), to: withOpacity(fill.to, percent) }),
			}}
			picker={picker}
		/>
	);
}

/** Whether a fill is at all see-through, which Outlook on Windows paints solid. */
function seeThrough(fill: MailFill): boolean {
	const colors = fill.kind === "solid" ? [fill.color] : [fill.from, fill.to];
	return colors.some((color) => (parseHex(color)?.a ?? 1) < 1);
}

/**
 * Figma's fill: one paint, a colour or a linear gradient, with the eye that
 * leaves it out of the message and the minus that removes it.
 */
export function FillSection({ fill, onFill }: FillSectionProps) {
	return (
		<PanelSection
			title="Fill"
			action={fill ? undefined : <PanelButton label="Add fill" icon="add" onClick={() => onFill(solidFill("#ffffff"))} />}
		>
			{fill ? (
				<>
					<div className="flex items-center gap-0.5">
						<div className="min-w-0 flex-1">
							<PaintRow fill={fill} onFill={onFill} />
						</div>
						<PanelButton
							label={fill.hidden ? "Show the fill" : "Hide the fill"}
							icon={fill.hidden ? "hidden" : "visible"}
							active={fill.hidden}
							onClick={() => onFill({ ...fill, hidden: !fill.hidden })}
						/>
						<PanelButton label="Remove the fill" icon="minus" onClick={() => onFill(null)} />
					</div>
					{fill.kind === "gradient" ? (
						<PanelNote>A client that cannot draw a gradient paints the start colour flat.</PanelNote>
					) : null}
					{seeThrough(fill) ? <PanelNote>Outlook on Windows paints a see-through colour solid.</PanelNote> : null}
				</>
			) : null}
		</PanelSection>
	);
}
