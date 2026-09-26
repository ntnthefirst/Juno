import type { MailBoxStyle, MailSides } from "@shared/types";
import { allSides } from "./canvas-actions";
import { ColorRow } from "./ColorRow";
import { NumberInput, PanelButton, PanelNote, PanelSection, PanelSelect } from "./panel-controls";

type StrokeSectionProps = {
	box: MailBoxStyle;
	onBox: (patch: Partial<MailBoxStyle>) => void;
};

/** The sides a stroke can be drawn on, as Figma's menu offers them. */
const SIDE_CHOICES: { value: string; label: string; sides: MailSides }[] = [
	{ value: "all", label: "All sides", sides: allSides() },
	{ value: "top", label: "Top", sides: { top: true, right: false, bottom: false, left: false } },
	{ value: "bottom", label: "Bottom", sides: { top: false, right: false, bottom: true, left: false } },
	{ value: "left", label: "Left", sides: { top: false, right: false, bottom: false, left: true } },
	{ value: "right", label: "Right", sides: { top: false, right: true, bottom: false, left: false } },
	{ value: "top-bottom", label: "Top and bottom", sides: { top: true, right: false, bottom: true, left: false } },
	{ value: "left-right", label: "Left and right", sides: { top: false, right: true, bottom: false, left: true } },
];

function sidesValue(sides: MailSides): string {
	return (
		SIDE_CHOICES.find(
			(choice) =>
				choice.sides.top === sides.top &&
				choice.sides.right === sides.right &&
				choice.sides.bottom === sides.bottom &&
				choice.sides.left === sides.left,
		)?.value ?? "custom"
	);
}

/**
 * Figma's stroke: the colour with its opacity, the eye and the minus, and
 * under it the style, the weight and the sides. A stroke on one side of an
 * empty section is a divider, which is why the sides are here.
 */
export function StrokeSection({ box, onBox }: StrokeSectionProps) {
	const drawn = box.borderWidth > 0;
	const sides = sidesValue(box.borderSides);
	return (
		<PanelSection
			title="Stroke"
			action={
				drawn ? undefined : (
					<PanelButton
						label="Add stroke"
						icon="add"
						onClick={() => onBox({ borderWidth: 1, borderColor: box.borderColor ?? "#e3e2ec", strokeHidden: false })}
					/>
				)
			}
		>
			{drawn ? (
				<>
					<div className="flex items-center gap-0.5">
						<div className="min-w-0 flex-1">
							<ColorRow
								label="Stroke"
								value={box.borderColor ?? "#e3e2ec"}
								onChange={(borderColor) => onBox({ borderColor })}
							/>
						</div>
						<PanelButton
							label={box.strokeHidden ? "Show the stroke" : "Hide the stroke"}
							icon={box.strokeHidden ? "hidden" : "visible"}
							active={box.strokeHidden}
							onClick={() => onBox({ strokeHidden: !box.strokeHidden })}
						/>
						<PanelButton label="Remove the stroke" icon="minus" onClick={() => onBox({ borderWidth: 0 })} />
					</div>
					<div className="grid grid-cols-[1fr_64px] gap-1.5">
						<PanelSelect
							label="Stroke style"
							value={box.borderStyle}
							onChange={(borderStyle) => onBox({ borderStyle: borderStyle as MailBoxStyle["borderStyle"] })}
							options={[
								{ value: "solid", label: "Solid" },
								{ value: "dashed", label: "Dashed" },
								{ value: "dotted", label: "Dotted" },
							]}
						/>
						<NumberInput
							label="Stroke weight"
							prefix="W"
							value={box.borderWidth}
							min={1}
							max={40}
							onChange={(borderWidth) => onBox({ borderWidth })}
						/>
					</div>
					<PanelSelect
						label="Stroke sides"
						value={sides}
						onChange={(value) => {
							const choice = SIDE_CHOICES.find((entry) => entry.value === value);
							if (choice) onBox({ borderSides: choice.sides });
						}}
						options={[
							...SIDE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
							...(sides === "custom" ? [{ value: "custom", label: "Custom" }] : []),
						]}
					/>
					{sides !== "all" ? <PanelNote>An empty section with only a bottom stroke is a divider.</PanelNote> : null}
				</>
			) : null}
		</PanelSection>
	);
}
