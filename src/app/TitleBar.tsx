import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { ContextMenu, type MenuItem } from "../components/Menu";
import { Icon, type IconName } from "../components/Icon";
import { Tooltip } from "../components/Tooltip";
import { overlayGutter } from "../lib/platform";
import { COMBOS, SCREEN_COMBOS, formatCombo } from "../lib/shortcuts";
import { AgentMenu } from "./AgentMenu";
import { RecentMenu } from "./RecentMenu";
import { RemindersMenu } from "./RemindersMenu";
import { TimerPill } from "./TimerPill";
import type { ScreenAction } from "../lib/screen-actions";
import { NEW_AT_RIGHT, NEW_MENU, NEW_ON, NEW_OWN_ICON, type NewMenuEntry, type ScreenId } from "./screens";

type TitleBarProps = {
	/**
	 * Where back goes, when a record is open over its list: the name of that list
	 * and the way there. Null at the top of a screen, where there is nowhere to go.
	 */
	back: { label: string; onSelect: () => void } | null;
	/** The page title, at the left after the divider, or after the way back while a record is open. */
	title: string;
	/** The screen on show, which decides what New offers and where it sits. */
	screen: ScreenId;
	onOpenPalette: () => void;
	recentOpen: boolean;
	onRecentOpenChange: (open: boolean) => void;
	/** The bell. It lists what is due soon, and the foot of that list opens the Reminders screen. */
	remindersActive: boolean;
	onOpenReminders: () => void;
	/** Asks the screen that owns a record to open its new-record form. */
	onNew: (screen: ScreenId, action?: ScreenAction) => void;
	/** The agent screen is on show, so its button is lit. The button lists what waits and what happened lately. */
	agentActive: boolean;
	/** Requests waiting for a person. A dot when more than zero. */
	agentPending: number;
	onOpenAgent: () => void;
	/** Where a screen draws its own controls beside the way back (TitleBarSlot). */
	slotRef: (element: HTMLDivElement | null) => void;
	/** Where a screen draws its own actions before the agent button (TitleBarSlot side="right"). */
	rightSlotRef: (element: HTMLDivElement | null) => void;
	/** Where a record draws its "..." menu, after New (TitleBarSlot side="overflow"). */
	overflowSlotRef: (element: HTMLDivElement | null) => void;
};

type TitleButtonProps = {
	icon: IconName;
	label: string;
	keys?: string[];
	active?: boolean;
	expanded?: boolean;
	onClick: () => void;
	buttonRef?: Ref<HTMLButtonElement>;
};

function TitleButton({ icon, label, keys, active = false, expanded, onClick, buttonRef }: TitleButtonProps) {
	return (
		<Tooltip label={label} keys={keys} side="bottom" className="no-drag flex">
			<button
				ref={buttonRef}
				type="button"
				onClick={onClick}
				aria-label={label}
				aria-haspopup={expanded === undefined ? undefined : "menu"}
				aria-expanded={expanded}
				aria-current={active ? "page" : undefined}
				className={[
					"flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] active:scale-90",
					active || expanded
						? "text-[var(--accent)]"
						: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
				].join(" ")}
			>
				<Icon name={icon} size={16} strokeWidth={1.9} />
			</button>
		</Tooltip>
	);
}

const AGENT_MENU_WIDTH = 360;

function Divider() {
	return <span aria-hidden className="mx-1 h-4 w-px flex-none bg-[var(--line)]" />;
}

/**
 * The window's own title bar, in the page colour with no rule under it. It is
 * the drag region, and the operating system draws the close, minimise and
 * maximise buttons on top of it (main/windows/chrome.ts), so the gutters in
 * `overlayGutter` stay empty for them.
 *
 * Left to right: Search, Recent and Reminders, a divider, then the page title,
 * or the way back, a slash and the record's name, and whatever the screen puts
 * beside it. At the right are the screen's own actions (a list's search is the
 * first), New, the record's "...", a divider and the agent.
 * The lock has no button here: it is in the palette and has its shortcut.
 *
 * Everything here is inside the drag region except the controls, which opt out
 * with `no-drag`. A button inside a drag region does not receive clicks.
 */
export function TitleBar({
	back,
	title,
	screen,
	onOpenPalette,
	recentOpen,
	onRecentOpenChange,
	remindersActive,
	onOpenReminders,
	onNew,
	agentActive,
	agentPending,
	onOpenAgent,
	slotRef,
	rightSlotRef,
	overflowSlotRef,
}: TitleBarProps) {
	const agentName = agentPending > 0 ? `Agent, ${agentPending} waiting for you` : "Agent";
	const recentButton = useRef<HTMLButtonElement>(null);
	const remindersButton = useRef<HTMLButtonElement>(null);
	const newButton = useRef<HTMLButtonElement>(null);
	const [recentAt, setRecentAt] = useState<{ x: number; y: number } | null>(null);
	const [newAt, setNewAt] = useState<{ x: number; y: number } | null>(null);
	const [remindersAt, setRemindersAt] = useState<{ x: number; y: number } | null>(null);
	const [agentAt, setAgentAt] = useState<{ x: number; y: number } | null>(null);
	const agentButton = useRef<HTMLButtonElement>(null);

	function toggleReminders(button: HTMLElement | null) {
		if (remindersAt) return setRemindersAt(null);
		const box = button?.getBoundingClientRect();
		if (box) setRemindersAt({ x: box.left, y: box.bottom + 4 });
	}

	function toggleAgent() {
		if (agentAt) return setAgentAt(null);
		const box = agentButton.current?.getBoundingClientRect();
		// Hung from its right edge, since the button sits at the right of the window.
		if (box) setAgentAt({ x: box.right - AGENT_MENU_WIDTH, y: box.bottom + 4 });
	}

	// Measured when the menu opens, whether the button or the shortcut did it.
	useLayoutEffect(() => {
		if (!recentOpen) return;
		const box = recentButton.current?.getBoundingClientRect();
		if (box) setRecentAt({ x: box.left, y: box.bottom + 4 });
	}, [recentOpen]);

	const here = NEW_ON[screen];
	// New is a text button at the right of every screen. Where the screen makes one
	// kind of record it makes that at once, and elsewhere it opens the New menu.
	const newDirect = here !== undefined && NEW_AT_RIGHT.includes(screen) ? here : null;
	// With a document open the text New goes, as the design draws it, and the plus
	// comes back at the left, which is where a page frame has it.
	const openDocument = screen === "documents" && back !== null;

	// What Ctrl N makes on the screen in view carries that shortcut. When the design's
	// list has no entry for it (a message, a document, a reminder) the screen adds
	// its own at the top, so writing mail is never further than the plus.
	const own: NewMenuEntry[] =
		here && !NEW_MENU.some((entry) => entry.label === here.label)
			? [{ screen: here.screen, label: here.label, icon: NEW_OWN_ICON[here.label] ?? "add" }]
			: [];
	const newItems: MenuItem[] = [...own, ...NEW_MENU].map((entry) => ({
		id: entry.label,
		label: entry.label,
		icon: entry.icon,
		separatorBefore: entry.separatorBefore,
		hint:
			entry.action === "new-page"
				? formatCombo(COMBOS.newPage).join(" ")
				: entry.screen === here?.screen && entry.label === here.label
					? formatCombo(COMBOS.newItem).join(" ")
					: undefined,
		onSelect: () => onNew(entry.screen, entry.action),
	}));

	function openNewMenu() {
		const box = newButton.current?.getBoundingClientRect();
		if (box) setNewAt({ x: box.left, y: box.bottom + 4 });
	}

	return (
		<header
			className="drag-region flex flex-none items-center gap-2 bg-[var(--paper)]"
			style={{
				height: "var(--titlebar-height)",
				paddingLeft: overlayGutter.left,
				paddingRight: overlayGutter.right,
			}}
		>
			<div className="flex min-w-0 flex-1 items-center gap-0.5">
				<TitleButton icon="search" label="Search" keys={formatCombo(COMBOS.palette)} onClick={onOpenPalette} />
				<TitleButton
					icon="recent"
					label="Recent"
					keys={formatCombo(COMBOS.recent)}
					expanded={recentOpen}
					buttonRef={recentButton}
					onClick={() => onRecentOpenChange(!recentOpen)}
				/>
				<TitleButton
					icon="reminders"
					label="Reminders"
					keys={formatCombo(COMBOS.reminders)}
					active={remindersActive}
					expanded={remindersAt !== null}
					buttonRef={remindersButton}
					onClick={() => toggleReminders(remindersButton.current)}
				/>
				{openDocument ? (
					<TitleButton
						icon="add"
						label="New"
						keys={formatCombo(COMBOS.newItem)}
						expanded={newAt !== null}
						buttonRef={newButton}
						onClick={openNewMenu}
					/>
				) : null}
				<Divider />

				{back ? (
					<Tooltip label="Back" keys={formatCombo(COMBOS.back)} side="bottom" className="no-drag flex min-w-0 flex-none">
						<button
							type="button"
							onClick={back.onSelect}
							className="animate-fade inline-flex h-7 min-w-0 max-w-[200px] items-center gap-1 rounded-[var(--radius-md)] pr-2 pl-1 text-dense font-[var(--weight-medium)] text-[var(--ink-muted)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] active:scale-[0.97]"
						>
							<Icon name="chevron-left" size={16} strokeWidth={2} className="flex-none" />
							<span className="truncate">{back.label}</span>
						</button>
					</Tooltip>
				) : null}
				{back && title ? (
					<span aria-hidden className="flex-none text-dense text-[var(--ink-faint)]">
						/
					</span>
				) : null}
				{title ? (
					<h1 className="min-w-0 truncate px-1.5 text-base font-[var(--weight-semibold)] text-[var(--ink)]">{title}</h1>
				) : null}
				<div ref={slotRef} className="flex min-w-0 items-center" />
			</div>

			<nav aria-label="Window" className="flex flex-none items-center justify-end gap-0.5">
				<TimerPill />
				<div ref={rightSlotRef} className="flex min-w-0 items-center" />
				{openDocument ? null : (
					<Tooltip label={newDirect ? newDirect.label : "New"} keys={formatCombo(COMBOS.newItem)} side="bottom" className="no-drag flex">
						<button
							ref={newButton}
							type="button"
							onClick={newDirect ? () => onNew(newDirect.screen) : openNewMenu}
							aria-label={newDirect ? newDirect.label : "New"}
							aria-haspopup={newDirect ? undefined : "menu"}
							aria-expanded={newDirect ? undefined : newAt !== null}
							className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-dense font-[var(--weight-medium)] whitespace-nowrap text-[var(--ink)] transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] active:scale-[0.97]"
						>
							<Icon name="add" size={14} strokeWidth={2} />
							New
						</button>
					</Tooltip>
				)}
				<div ref={overflowSlotRef} className="flex min-w-0 items-center" />
				<Divider />
				<Tooltip label={agentName} keys={SCREEN_COMBOS.agent ? formatCombo(SCREEN_COMBOS.agent) : undefined} side="bottom" className="no-drag flex">
					<button
						type="button"
						ref={agentButton}
						data-nav="agent"
						onClick={toggleAgent}
						aria-label={agentName}
						aria-haspopup="dialog"
						aria-expanded={agentAt !== null}
						aria-current={agentActive ? "page" : undefined}
						className={[
							"relative flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] active:scale-90",
							agentActive || agentAt ? "text-[var(--accent)]" : "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						<Icon name="agent" size={18} strokeWidth={1.9} />
						{agentPending > 0 ? (
							<span
								aria-hidden
								className="absolute top-[6px] right-[6px] h-2 w-2 rounded-[var(--radius-full)] bg-[var(--warn)] ring-2 ring-[var(--paper)]"
							/>
						) : null}
					</button>
				</Tooltip>
			</nav>

			{recentOpen && recentAt ? <RecentMenu at={recentAt} onClose={() => onRecentOpenChange(false)} /> : null}
			{remindersAt ? (
				<RemindersMenu at={remindersAt} onClose={() => setRemindersAt(null)} onOpenScreen={onOpenReminders} />
			) : null}
			{agentAt ? <AgentMenu at={agentAt} onClose={() => setAgentAt(null)} onOpenScreen={onOpenAgent} /> : null}
			{newAt ? (
				<ContextMenu at={newAt} items={newItems} onClose={() => setNewAt(null)} ariaLabel="New" anchor="top-left" />
			) : null}
		</header>
	);
}
