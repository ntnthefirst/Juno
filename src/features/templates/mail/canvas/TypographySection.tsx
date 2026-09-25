import { useState } from "react";
import type { MailFont, MailFontFallback, MailTextStyle, MailWeight } from "@shared/types";
import { SYSTEM_FONTS, WEIGHT_LABELS, FONT_WEIGHTS } from "./box-style";
import {
	ColorInput,
	NumberInput,
	PanelButton,
	PanelNote,
	PanelPair,
	PanelSection,
	PanelSelect,
	Segmented,
	TextInput,
} from "./panel-controls";

type TypographySectionProps = {
	text: MailTextStyle;
	onText: (patch: Partial<MailTextStyle>) => void;
	/** The fonts the message links, which are offered next to the system ones. */
	fonts: MailFont[];
	/**
	 * Links a Google font by name and sets this text in it, as one change. Two
	 * changes made from the same starting canvas would have the second undo
	 * the first, and the font would be named without ever being linked.
	 */
	onLinkAndUse: (family: string, fallback: MailFontFallback) => void;
	/** Off for a button, whose label colour is part of what the button is. */
	showColor: boolean;
	/** Only a text block or a heading can sit lower in a taller box. */
	showVertical: boolean;
};

/** The message's own typeface, which is what a block with no family is set in. */
const OWN = "";

const WEIGHT_ORDER = Object.keys(FONT_WEIGHTS) as MailWeight[];

/** Matches toFamily in services/mail-layout.ts. */
function cleanFamily(value: string): string | null {
	const trimmed = value.trim().replace(/\s+/g, " ");
	return /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/.test(trimmed) ? trimmed : null;
}

/**
 * Figma's typography panel, as much of it as a mail client renders.
 *
 * The family is one of three kinds: the message's own, one every mail client
 * has, or one the message links. Linking a Google font is offered right here,
 * because that is where somebody is when they want one. Everything else is the
 * set Figma shows, bar the OpenType features, which no mail client applies.
 */
export function TypographySection({ text, onText, fonts, onLinkAndUse, showColor, showVertical }: TypographySectionProps) {
	const [linking, setLinking] = useState(false);
	const [name, setName] = useState("");
	const [fallback, setFallback] = useState<MailFontFallback>("sans");

	const family = text.fontFamily ?? OWN;
	const known = family === OWN || family in SYSTEM_FONTS || fonts.some((font) => font.family === family);
	const linked = fonts.find((font) => font.family === family);
	const missingWeight =
		linked?.source === "google" && !linked.weights.includes(FONT_WEIGHTS[text.weight]) ? linked : null;

	const clean = cleanFamily(name);

	function link(): void {
		if (!clean) return;
		onLinkAndUse(clean, fallback);
		setName("");
		setLinking(false);
	}

	return (
		<PanelSection title="Typography">
			<div className="flex items-center gap-1">
				<div className="min-w-0 flex-1">
					<PanelSelect
						label="Font family"
						value={family}
						onChange={(next) => onText({ fontFamily: next === OWN ? null : next })}
						options={[
							{ value: OWN, label: "Message font (Inter)" },
							...Object.keys(SYSTEM_FONTS).map((system) => ({ value: system, label: system })),
							...fonts.map((font) => ({ value: font.family, label: `${font.family} (linked)` })),
							...(known ? [] : [{ value: family, label: `${family} (not linked)` }]),
						]}
					/>
				</div>
				<PanelButton
					label={linking ? "Stop linking a font" : "Link a Google font"}
					icon={linking ? "close" : "add"}
					onClick={() => setLinking((current) => !current)}
				/>
			</div>

			{linking ? (
				<div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2">
					<TextInput
						label="Google font family"
						value={name}
						placeholder="Playfair Display"
						onChange={setName}
						onEnter={link}
					/>
					<Segmented
						label="Fallback"
						value={fallback}
						options={[
							{ value: "sans", label: "Sans", title: "Falls back to Arial" },
							{ value: "serif", label: "Serif", title: "Falls back to Georgia" },
							{ value: "mono", label: "Mono", title: "Falls back to Courier New" },
						]}
						onChange={setFallback}
					/>
					<PanelNote>
						{name && !clean
							? "Letters, digits, spaces and hyphens, the way fonts.google.com writes it."
							: "Linked with regular and bold. The fallback is what Gmail and Outlook on Windows show. The frame's Fonts section adds weights."}
					</PanelNote>
					<button
						type="button"
						disabled={!clean}
						onClick={link}
						className="h-[28px] rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--accent-ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-50"
					>
						Link and use
					</button>
				</div>
			) : null}

			<PanelPair>
				<PanelSelect
					label="Weight"
					value={text.weight}
					onChange={(next) => onText({ weight: next as MailWeight })}
					options={WEIGHT_ORDER.map((weight) => ({
						value: weight,
						label: `${WEIGHT_LABELS[weight]} ${FONT_WEIGHTS[weight]}`,
					}))}
				/>
				<NumberInput
					label="Font size"
					prefix="Aa"
					value={text.fontSize}
					unset={{ label: "15", onClear: () => onText({ fontSize: null }) }}
					min={8}
					max={96}
					onChange={(next) => onText({ fontSize: next })}
				/>
			</PanelPair>

			<PanelPair>
				<NumberInput
					label="Line height"
					prefix="LH"
					value={text.lineHeight}
					unset={{ label: "1.65", onClear: () => onText({ lineHeight: null }) }}
					min={0.8}
					max={4}
					step={0.05}
					onChange={(next) => onText({ lineHeight: next })}
				/>
				<NumberInput
					label="Letter spacing in pixels"
					prefix="LS"
					value={text.letterSpacing}
					unset={{ label: "0", onClear: () => onText({ letterSpacing: null }) }}
					min={-10}
					max={40}
					step={0.1}
					onChange={(next) => onText({ letterSpacing: next === 0 ? null : next })}
				/>
			</PanelPair>

			{missingWeight ? (
				<PanelNote tone="warn">
					{missingWeight.family} is linked in {missingWeight.weights.join(", ")}. At{" "}
					{FONT_WEIGHTS[text.weight]} the client makes one up. Add the weight on the frame, under Fonts.
				</PanelNote>
			) : null}

			<Segmented
				label="Horizontal alignment"
				value={text.align}
				options={[
					{ value: "left", label: "Left", icon: "align-left", title: "Align left" },
					{ value: "center", label: "Centre", icon: "align-center", title: "Align centre" },
					{ value: "right", label: "Right", icon: "align-right", title: "Align right" },
					{ value: "justify", label: "Justify", icon: "align-justify", title: "Justify" },
				]}
				onChange={(align) => onText({ align })}
			/>

			{showVertical ? (
				<Segmented
					label="Vertical alignment"
					value={text.verticalAlign}
					options={[
						{ value: "top", label: "Top", icon: "text-top", title: "Text at the top" },
						{ value: "middle", label: "Middle", icon: "text-middle", title: "Text in the middle" },
						{ value: "bottom", label: "Bottom", icon: "text-bottom", title: "Text at the bottom" },
					]}
					onChange={(verticalAlign) => onText({ verticalAlign })}
				/>
			) : null}

			<div className="flex items-center gap-1">
				<PanelButton
					label="Italic"
					icon="italic"
					active={text.italic}
					onClick={() => onText({ italic: !text.italic })}
				/>
				<PanelButton
					label="Underline"
					icon="underline"
					active={text.decoration === "underline"}
					onClick={() => onText({ decoration: text.decoration === "underline" ? "none" : "underline" })}
				/>
				<PanelButton
					label="Strikethrough"
					icon="strike"
					active={text.decoration === "strike"}
					onClick={() => onText({ decoration: text.decoration === "strike" ? "none" : "strike" })}
				/>
				<span aria-hidden className="mx-1 h-[18px] w-px bg-[var(--line)]" />
				<div className="min-w-0 flex-1">
					<Segmented
						label="Letter case"
						value={text.transform}
						options={[
							{ value: "none", label: "Aa", title: "As typed" },
							{ value: "upper", label: "AB", title: "Uppercase" },
							{ value: "lower", label: "ab", title: "Lowercase" },
							{ value: "title", label: "Ab", title: "Capitalise each word" },
						]}
						onChange={(transform) => onText({ transform })}
					/>
				</div>
			</div>

			{showColor ? (
				<ColorInput label="Text colour" value={text.color} fallback="#16161d" onChange={(color) => onText({ color })} />
			) : null}

			<PanelNote>An empty size or line height is the message's own, 15 and 1.65. Clear one to go back to it.</PanelNote>
			<PanelNote>Bold, italic and links inside the text: double-click the block on the canvas.</PanelNote>
		</PanelSection>
	);
}
