import { useState, type ReactNode } from "react";
import type { MailAction, MailClickAction, MailHoverAction } from "@shared/types";
import { clickProblem, hasClick, newClick, newHover, type HoverChange } from "./canvas-actions";
import { ColorRow } from "./ColorRow";
import { PaintRow } from "./FillSection";
import { NumberInput, PanelButton, PanelNote, PanelSection, PanelSelect, TextInput } from "./panel-controls";

type ActionsSectionProps = {
	actions: MailAction[];
	/** Why an on-click action cannot be added here, or null when it can. */
	clickBlocked: string | null;
	/** Whether a click links the whole box, which Outlook on Windows does not: the text inside is all it makes clickable. */
	wholeBox: boolean;
	onActions: (actions: MailAction[]) => void;
};

const CLICK_KINDS: { value: MailClickAction["kind"]; label: string }[] = [
	{ value: "link", label: "Open a link" },
	{ value: "mail", label: "Start a mail" },
	{ value: "call", label: "Call" },
];

const HOVER_CHANGES: { value: HoverChange; label: string }[] = [
	{ value: "fill", label: "Fill" },
	{ value: "color", label: "Text colour" },
	{ value: "underline", label: "Underline" },
	{ value: "opacity", label: "Opacity" },
];

const TARGETS: Record<MailClickAction["kind"], { label: string; placeholder: string }> = {
	link: { label: "Link address", placeholder: "example.com/page" },
	mail: { label: "Email address", placeholder: "naam@voorbeeld.be" },
	call: { label: "Phone number", placeholder: "+32 470 12 34 56" },
};

const OPTION =
	"flex h-[28px] w-full items-center rounded-[var(--radius-sm)] px-2 text-left text-[length:var(--text-sm)] text-[var(--ink)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus";

type RowFrameProps = {
	trigger: string;
	what: ReactNode;
	hidden: boolean;
	name: string;
	onHidden: (hidden: boolean) => void;
	onRemove: () => void;
};

/** The row every action shares: the trigger, what it does, the eye and the minus. */
function RowFrame({ trigger, what, hidden, name, onHidden, onRemove }: RowFrameProps) {
	return (
		<div className="flex items-center gap-0.5">
			<span className="w-[52px] flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">{trigger}</span>
			<div className="min-w-0 flex-1">{what}</div>
			<PanelButton
				label={hidden ? `Show ${name}` : `Hide ${name}`}
				icon={hidden ? "hidden" : "visible"}
				active={hidden}
				onClick={() => onHidden(!hidden)}
			/>
			<PanelButton label={`Remove ${name}`} icon="minus" onClick={onRemove} />
		</div>
	);
}

type ClickRowProps = {
	action: MailClickAction;
	wholeBox: boolean;
	onChange: (action: MailClickAction) => void;
	onRemove: () => void;
};

function ClickRow({ action, wholeBox, onChange, onRemove }: ClickRowProps) {
	const target = TARGETS[action.kind];
	const problem = clickProblem(action);
	return (
		<div className="flex flex-col gap-1.5">
			<RowFrame
				trigger="On click"
				name="the click action"
				hidden={action.hidden}
				onHidden={(hidden) => onChange({ ...action, hidden })}
				onRemove={onRemove}
				what={
					<PanelSelect
						label="What a click does"
						value={action.kind}
						options={CLICK_KINDS}
						onChange={(kind) => onChange({ ...action, kind: kind as MailClickAction["kind"] })}
					/>
				}
			/>
			<TextInput
				label={target.label}
				value={action.target}
				placeholder={target.placeholder}
				onChange={(next) => onChange({ ...action, target: next })}
			/>
			{problem ? (
				<PanelNote tone="warn">{problem}</PanelNote>
			) : action.target.trim() === "" ? (
				<PanelNote>Empty, so it is sent without a link.</PanelNote>
			) : null}
			{wholeBox ? <PanelNote>Outlook on Windows makes only the text inside a link clickable, not the whole box.</PanelNote> : null}
		</div>
	);
}

type HoverRowProps = {
	action: MailHoverAction;
	/** The changes the other rows already use, which this one cannot also pick. */
	taken: HoverChange[];
	onChange: (action: MailHoverAction) => void;
	onRemove: () => void;
};

function HoverRow({ action, taken, onChange, onRemove }: HoverRowProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<RowFrame
				trigger="On hover"
				name="the hover action"
				hidden={action.hidden}
				onHidden={(hidden) => onChange({ ...action, hidden })}
				onRemove={onRemove}
				what={
					<PanelSelect
						label="What hovering changes"
						value={action.change}
						options={HOVER_CHANGES.filter((option) => option.value === action.change || !taken.includes(option.value))}
						onChange={(change) => onChange({ ...newHover(change as HoverChange), id: action.id, hidden: action.hidden })}
					/>
				}
			/>
			{action.change === "fill" && action.fill ? (
				<PaintRow label="Hover fill" fill={action.fill} onFill={(fill) => onChange({ ...action, fill })} />
			) : null}
			{action.change === "color" && action.color ? (
				<ColorRow label="Hover text colour" value={action.color} onChange={(color) => onChange({ ...action, color })} />
			) : null}
			{action.change === "underline" ? (
				<PanelSelect
					label="Hover underline"
					value={action.underline === false ? "off" : "on"}
					options={[
						{ value: "on", label: "Underlined" },
						{ value: "off", label: "Not underlined" },
					]}
					onChange={(next) => onChange({ ...action, underline: next === "on" })}
				/>
			) : null}
			{action.change === "opacity" ? (
				<NumberInput
					label="Hover opacity"
					prefix="%"
					value={Math.round((action.opacity ?? 1) * 100)}
					min={0}
					max={100}
					onChange={(percent) => onChange({ ...action, opacity: percent / 100 })}
				/>
			) : null}
		</div>
	);
}

/**
 * What happens when somebody interacts with the element, as rows like the
 * effects: a trigger, what it does, the eye and the minus. On click opens a
 * link, starts a mail or dials a number; on hover changes the fill, the text
 * colour, the underline or the opacity. That is all an email can do, because
 * every mail client removes scripts, so there is nothing else to offer.
 */
export function ActionsSection({ actions, clickBlocked, wholeBox, onActions }: ActionsSectionProps) {
	const [adding, setAdding] = useState(false);
	const clicked = hasClick(actions);
	const used = actions.flatMap((action) => (action.trigger === "hover" ? [action.change] : []));
	const options: { key: string; label: string; make: () => MailAction }[] = [
		...(clicked || clickBlocked ? [] : [{ key: "click", label: "On click", make: newClick }]),
		...HOVER_CHANGES.filter((option) => !used.includes(option.value)).map((option) => ({
			key: option.value,
			label: `On hover: ${option.label.toLowerCase()}`,
			make: () => newHover(option.value),
		})),
	];
	const replace = (id: string, next: MailAction) => onActions(actions.map((action) => (action.id === id ? next : action)));
	const remove = (id: string) => onActions(actions.filter((action) => action.id !== id));

	return (
		<PanelSection
			title="Actions"
			action={
				<PanelButton
					label="Add action"
					icon="add"
					active={adding}
					disabled={options.length === 0}
					onClick={() => setAdding((open) => !open)}
				/>
			}
		>
			{adding && options.length > 0 ? (
				<div role="menu" aria-label="Add action" className="flex flex-col rounded-[var(--radius-sm)] border border-[var(--line)] p-0.5">
					{options.map((option) => (
						<button
							key={option.key}
							type="button"
							role="menuitem"
							onClick={() => {
								onActions([...actions, option.make()]);
								setAdding(false);
							}}
							className={OPTION}
						>
							{option.label}
						</button>
					))}
				</div>
			) : null}
			{!clicked && clickBlocked ? <PanelNote>{clickBlocked}</PanelNote> : null}
			{actions.map((action) =>
				action.trigger === "click" ? (
					<ClickRow
						key={action.id}
						action={action}
						wholeBox={wholeBox}
						onChange={(next) => replace(action.id, next)}
						onRemove={() => remove(action.id)}
					/>
				) : (
					<HoverRow
						key={action.id}
						action={action}
						taken={used}
						onChange={(next) => replace(action.id, next)}
						onRemove={() => remove(action.id)}
					/>
				),
			)}
			{used.length > 0 ? (
				<PanelNote tone="warn">
					Works in Apple Mail, iOS Mail and Outlook on the web. Not in Gmail or Outlook on Windows.
				</PanelNote>
			) : null}
		</PanelSection>
	);
}
