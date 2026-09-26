import { useState } from "react";
import type { MailBoxStyle, MailEffect } from "@shared/types";
import type { IconName } from "../../../../components/Icon";
import { effectLabel } from "./box-style";
import { newBlur, newShadow } from "./canvas-actions";
import { withOpacity, opacityPercent } from "./color";
import { ColorRow } from "./ColorRow";
import { NumberInput, PanelButton, PanelNote, PanelPair, PanelSection, PanelSelect } from "./panel-controls";

type EffectsSectionProps = {
	box: MailBoxStyle;
	onBox: (patch: Partial<MailBoxStyle>) => void;
};

type EffectKind = "drop" | "inner" | "blur";

function kindOf(effect: MailEffect): EffectKind {
	return effect.kind === "blur" ? "blur" : effect.inset ? "inner" : "drop";
}

const KIND_ICONS: Record<EffectKind, IconName> = { drop: "effect-drop", inner: "effect-inner", blur: "effect-blur" };

type EffectRowProps = {
	effect: MailEffect;
	onChange: (effect: MailEffect) => void;
	onRemove: () => void;
};

/**
 * One effect as Figma lists it: the button that opens its settings, what kind
 * it is, the eye and the minus. The settings open under the row.
 */
function EffectRow({ effect, onChange, onRemove }: EffectRowProps) {
	const [open, setOpen] = useState(false);
	const kind = kindOf(effect);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-0.5">
				<PanelButton
					label={open ? `Close the ${effectLabel(effect).toLowerCase()} settings` : `${effectLabel(effect)} settings`}
					icon={KIND_ICONS[kind]}
					active={open}
					onClick={() => setOpen((current) => !current)}
				/>
				<div className="min-w-0 flex-1">
					<PanelSelect
						label="Effect"
						value={kind}
						onChange={(next) =>
							onChange({ ...(next === "blur" ? newBlur() : newShadow(next === "inner")), hidden: effect.hidden })
						}
						options={[
							{ value: "drop", label: "Drop shadow" },
							{ value: "inner", label: "Inner shadow" },
							{ value: "blur", label: "Layer blur" },
						]}
					/>
				</div>
				<PanelButton
					label={effect.hidden ? `Show the ${effectLabel(effect).toLowerCase()}` : `Hide the ${effectLabel(effect).toLowerCase()}`}
					icon={effect.hidden ? "hidden" : "visible"}
					active={effect.hidden}
					onClick={() => onChange({ ...effect, hidden: !effect.hidden })}
				/>
				<PanelButton label={`Remove the ${effectLabel(effect).toLowerCase()}`} icon="minus" onClick={onRemove} />
			</div>

			{open && effect.kind === "blur" ? (
				<NumberInput
					label="Blur radius"
					prefix="R"
					value={effect.radius}
					min={0}
					max={60}
					onChange={(radius) => onChange({ ...effect, radius })}
				/>
			) : null}
			{open && effect.kind === "shadow" ? (
				<div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] p-1.5">
					<PanelPair>
						<NumberInput label="Offset across" prefix="X" value={effect.x} min={-200} max={200} onChange={(x) => onChange({ ...effect, x })} />
						<NumberInput label="Offset down" prefix="Y" value={effect.y} min={-200} max={200} onChange={(y) => onChange({ ...effect, y })} />
					</PanelPair>
					<PanelPair>
						<NumberInput label="Blur" prefix="B" value={effect.blur} min={0} max={200} onChange={(blur) => onChange({ ...effect, blur })} />
						<NumberInput
							label="Spread"
							prefix="S"
							value={effect.spread}
							min={-100}
							max={100}
							onChange={(spread) => onChange({ ...effect, spread })}
						/>
					</PanelPair>
					{/* The shadow keeps its opacity beside its colour, so the row's
					    percentage is that opacity and the colour stays solid. */}
					<ColorRow
						label="Shadow"
						value={withOpacity(effect.color, effect.opacity * 100)}
						onChange={(color) => onChange({ ...effect, color: color.slice(0, 7), opacity: opacityPercent(color) / 100 })}
					/>
				</div>
			) : null}
		</div>
	);
}

/** Figma's effects: shadows and a blur, each a row with its settings behind it. */
export function EffectsSection({ box, onBox }: EffectsSectionProps) {
	const replace = (index: number, effect: MailEffect) =>
		onBox({ effects: box.effects.map((entry, position) => (position === index ? effect : entry)) });
	return (
		<PanelSection
			title="Effects"
			action={
				<PanelButton label="Add effect" icon="add" onClick={() => onBox({ effects: [...box.effects, newShadow(false)] })} />
			}
		>
			{box.effects.map((effect, index) => (
				<EffectRow
					key={`${effect.kind}-${index}`}
					effect={effect}
					onChange={(next) => replace(index, next)}
					onRemove={() => onBox({ effects: box.effects.filter((_entry, position) => position !== index) })}
				/>
			))}
			{box.effects.length > 0 ? <PanelNote tone="warn">Outlook on Windows draws neither shadows nor blur.</PanelNote> : null}
		</PanelSection>
	);
}
