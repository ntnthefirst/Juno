import type { MailBlock } from "@shared/types";
import { Icon, type IconName } from "../../../../components/Icon";
import type { EditorMode } from "../EditorSidebar";
import { BLOCK_KIND_LABELS, BLOCK_KINDS, type BlockKind } from "./canvas-actions";
import { keysFor } from "./shortcuts";
import { ShortcutList } from "./ShortcutList";

type CanvasToolbarProps = {
	/** Whether blocks can be added: on the canvas, and not on a hand-written body. */
	insertable: boolean;
	onInsert: (kind: BlockKind) => void;
	onAddSection: () => void;
	mode: EditorMode;
	onMode: (mode: EditorMode) => void;
	/** A template without a canvas calls its first view the body. */
	hasLayout: boolean;
	inputCount: number;
	/** Whether the list of keyboard shortcuts is open over the toolbar. */
	help: boolean;
	onHelp: (open: boolean) => void;
};

const TOOL_ICONS: Record<Exclude<MailBlock["kind"], "html">, IconName> = {
	text: "tool-text",
	heading: "tool-heading",
	button: "tool-button",
	image: "image",
	field: "tool-input",
	divider: "tool-divider",
	spacer: "tool-spacer",
};

type ToolButtonProps = {
	label: string;
	icon: IconName;
	/** The key that does the same, shown in the tooltip. */
	keys: string | null;
	onClick: () => void;
};

/** One tool: a glyph, with its name and its key in the tooltip, and its name for a screen reader. */
function ToolButton({ label, icon, keys, onClick }: ToolButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={keys ? `${label} (${keys})` : label}
			onClick={onClick}
			className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
		>
			<Icon name={icon} size={18} />
		</button>
	);
}

type ModeButtonProps = {
	label: string;
	icon: IconName;
	active: boolean;
	onClick: () => void;
	count?: number;
};

function ModeButton({ label, icon, active, onClick, count = 0 }: ModeButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={active}
			onClick={onClick}
			className={`relative flex h-[30px] w-[34px] flex-none items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
				active
					? "bg-[var(--surface)] text-[var(--accent)] shadow-[var(--shadow-popover)]"
					: "text-[var(--ink-muted)] hover:text-[var(--ink)]"
			}`}
		>
			<Icon name={icon} size={16} />
			{count > 0 ? (
				<span className="tabular absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent)] px-1 text-[length:var(--text-micro)] leading-none font-[var(--weight-semibold)] text-[var(--accent-ink)]">
					{count}
				</span>
			) : null}
		</button>
	);
}

/**
 * The toolbar that floats over the bottom of the canvas, the way Figma's does.
 *
 * On the left, everything that can go in a message, as glyphs with their names
 * and keys in the tooltips; pressing one adds it after what is selected, or to
 * the last section showing. On the right, in a group of their own, the four
 * ways of looking at the template, which is where Figma keeps its modes, and
 * the list of keyboard shortcuts. A code block is not a tool: any block
 * becomes one with "Convert to HTML" in the design panel.
 */
export function CanvasToolbar({
	insertable,
	onInsert,
	onAddSection,
	mode,
	onMode,
	hasLayout,
	inputCount,
	help,
	onHelp,
}: CanvasToolbarProps) {
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
			<div className="pointer-events-auto relative flex max-w-full">
				{help ? <ShortcutList onClose={() => onHelp(false)} /> : null}
				<div
					role="toolbar"
					aria-label="Canvas tools"
					className="flex max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-popover)]"
				>
					{insertable ? (
						<>
							<ToolButton label="Add a section" icon="tool-section" keys={keysFor("Section")} onClick={onAddSection} />
							{BLOCK_KINDS.map((kind) =>
								kind === "html" ? null : (
									<ToolButton
										key={kind}
										label={`Add ${BLOCK_KIND_LABELS[kind].toLowerCase()}`}
										icon={TOOL_ICONS[kind]}
										keys={keysFor(BLOCK_KIND_LABELS[kind])}
										onClick={() => onInsert(kind)}
									/>
								),
							)}
							<span aria-hidden className="mx-1 h-[24px] w-px flex-none bg-[var(--line)]" />
						</>
					) : null}
					<div
						role="group"
						aria-label="View"
						className="flex flex-none items-center gap-0.5 rounded-[var(--radius-lg)] bg-[var(--sunken)] p-0.5"
					>
						<ModeButton
							label={hasLayout ? "The canvas" : "The body"}
							icon={hasLayout ? "view-canvas" : "note"}
							active={mode === "canvas"}
							onClick={() => onMode("canvas")}
						/>
						<ModeButton
							label="The message as it will be sent"
							icon="visible"
							active={mode === "preview"}
							onClick={() => onMode("preview")}
						/>
						<ModeButton label="The HTML under it" icon="view-code" active={mode === "code"} onClick={() => onMode("code")} />
						<ModeButton
							label="What this template asks for"
							icon="list"
							active={mode === "inputs"}
							onClick={() => onMode("inputs")}
							count={inputCount}
						/>
					</div>
					<button
						type="button"
						data-shortcut-toggle
						aria-label="Keyboard shortcuts"
						title={`Keyboard shortcuts (${keysFor("These shortcuts") ?? "?"})`}
						aria-expanded={help}
						onClick={() => onHelp(!help)}
						className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${
							help
								? "bg-[var(--accent-soft)] text-[var(--accent)]"
								: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						}`}
					>
						<Icon name="keyboard" size={18} />
					</button>
				</div>
			</div>
		</div>
	);
}
