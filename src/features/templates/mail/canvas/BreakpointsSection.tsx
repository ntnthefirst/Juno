import { useState } from "react";
import type { MailLayout } from "@shared/types";
import { Icon } from "../../../../components/Icon";
import { addBreakpoint, removeBreakpoint, renameBreakpoint, resizeBreakpoint, widestFirst } from "./breakpoints";
import { PanelButton, PanelNote, PanelSection } from "./panel-controls";

type BreakpointsSectionProps = {
	/** The canvas as it is stored, breakpoints and all. */
	layout: MailLayout;
	/** The breakpoint being edited, or null for the default. */
	active: string | null;
	onActive: (id: string | null) => void;
	onLayout: (next: MailLayout) => void;
};

type WidthFieldProps = {
	label: string;
	value: number;
	onChange: (value: number) => void;
};

/** A width typed into a row, committed on Enter or on leaving it. */
function WidthField({ label, value, onChange }: WidthFieldProps) {
	const [typed, setTyped] = useState<{ over: number; text: string } | null>(null);
	const shown = typed && typed.over === value ? typed.text : String(value);
	const commit = () => {
		setTyped(null);
		const next = Number.parseInt(shown, 10);
		if (Number.isFinite(next) && next !== value) onChange(next);
	};
	return (
		<label className="flex h-[24px] w-[62px] flex-none items-center rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 focus-within:bg-[var(--surface)] focus-within:outline-1 focus-within:outline-[var(--accent)]">
			<span className="sr-only">{label}</span>
			<input
				value={shown}
				inputMode="numeric"
				onChange={(event) => setTyped({ over: value, text: event.target.value })}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
				className="tabular min-w-0 flex-1 bg-transparent text-right text-[length:var(--text-sm)] text-[var(--ink)] focus:outline-none"
			/>
			<span className="pl-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">px</span>
		</label>
	);
}

type RowProps = {
	name: string;
	/** The widest screen it applies to. Default has none: it is the message without a media query. */
	width: number | null;
	active: boolean;
	onSelect: () => void;
	onRename?: (name: string) => void;
	onWidth?: (width: number) => void;
	onRemove?: () => void;
};

/** One way the message is designed. Pressing it edits the canvas as that breakpoint draws it. */
function BreakpointRow({ name, width, active, onSelect, onRename, onWidth, onRemove }: RowProps) {
	const [renaming, setRenaming] = useState<string | null>(null);
	const commitName = () => {
		if (renaming !== null && onRename) onRename(renaming);
		setRenaming(null);
	};
	return (
		<div
			className={`flex h-[28px] items-center gap-1 rounded-[var(--radius-sm)] pr-0.5 ${
				active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
			}`}
		>
			{renaming !== null ? (
				<input
					autoFocus
					value={renaming}
					aria-label="Breakpoint name"
					onChange={(event) => setRenaming(event.target.value)}
					onBlur={commitName}
					onKeyDown={(event) => {
						if (event.key === "Enter") commitName();
						if (event.key === "Escape") {
							event.stopPropagation();
							setRenaming(null);
						}
					}}
					className="h-[24px] min-w-0 flex-1 rounded-[var(--radius-sm)] bg-[var(--surface)] px-1.5 text-[length:var(--text-sm)] text-[var(--ink)] outline-1 outline-[var(--accent)] focus:outline-1"
				/>
			) : (
				<button
					type="button"
					aria-pressed={active}
					title={onRename ? "Edit the canvas at this width. Double-click to rename" : "Edit the message as every width sees it"}
					onClick={onSelect}
					onDoubleClick={() => (onRename ? setRenaming(name) : undefined)}
					className={`flex h-[28px] min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-left text-[length:var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
						active ? "font-[var(--weight-medium)] text-[var(--accent)]" : "text-[var(--ink)]"
					}`}
				>
					<Icon
						name={width === null || width >= 700 ? "device-desktop" : width >= 540 ? "device-tablet" : "device-phone"}
						size={13}
						className="flex-none"
					/>
					<span className="truncate">{name}</span>
				</button>
			)}
			{width !== null && onWidth ? <WidthField label={`${name} width`} value={width} onChange={onWidth} /> : null}
			{onRemove ? <PanelButton label={`Remove ${name}`} icon="minus" onClick={onRemove} /> : null}
		</div>
	);
}

/**
 * The widths the message changes at, Figma's breakpoints. Default is the
 * design itself, what the CSS says with no media query around it, so it has no
 * width of its own; the canvas draws it at the frame's width. Every other row
 * is a width at and below which the message looks different. Pressing one
 * draws the canvas at that width, and what is changed from then on changes
 * there and narrower.
 */
export function BreakpointsSection({ layout, active, onActive, onLayout }: BreakpointsSectionProps) {
	const add = addBreakpoint(layout);
	return (
		<PanelSection
			title="Breakpoints"
			action={
				<PanelButton
					label={add ? "Add a breakpoint" : "Four breakpoints is the most a message has"}
					icon="add"
					disabled={!add}
					onClick={() => {
						if (!add) return;
						onLayout(add.layout);
						onActive(add.id);
					}}
				/>
			}
		>
			<div className="flex flex-col gap-px">
				<BreakpointRow name="Default" width={null} active={active === null} onSelect={() => onActive(null)} />
				{widestFirst(layout.breakpoints).map((breakpoint) => (
					<BreakpointRow
						key={breakpoint.id}
						name={breakpoint.name}
						width={breakpoint.maxWidth}
						active={active === breakpoint.id}
						onSelect={() => onActive(breakpoint.id)}
						onRename={(name) => onLayout(renameBreakpoint(layout, breakpoint.id, name))}
						onWidth={(width) => onLayout(resizeBreakpoint(layout, breakpoint.id, width))}
						onRemove={() => {
							onLayout(removeBreakpoint(layout, breakpoint.id));
							if (active === breakpoint.id) onActive(null);
						}}
					/>
				))}
			</div>
			{layout.breakpoints.length > 0 ? (
				<PanelNote>
					Default is the message with no media query. A breakpoint starts as a copy of the widths above it, and what
					you change while it is selected applies at its width and narrower. Outlook on Windows shows the default.
				</PanelNote>
			) : null}
		</PanelSection>
	);
}
