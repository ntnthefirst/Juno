import { Icon } from "../components/Icon";
import { Kbd } from "../components/Kbd";
import { Tooltip } from "../components/Tooltip";
import { overlayGutter } from "../lib/platform";
import { COMBOS, SCREEN_COMBOS, formatCombo } from "../lib/shortcuts";

type TitleBarProps = {
	/**
	 * Where back goes, when a record is open over its list: the name of that list
	 * and the way there. Null at the top of a screen, where there is nowhere to go.
	 */
	back: { label: string; onSelect: () => void } | null;
	onOpenPalette: () => void;
	lockConfigured: boolean;
	onLock: () => void;
	/** The agent screen is on show, so its button is lit. */
	agentActive: boolean;
	/** Requests waiting for a person. A dot when more than zero. */
	agentPending: number;
	onOpenAgent: () => void;
	/** Where a screen draws its own controls (TitleBarSlot). */
	slotRef: (element: HTMLDivElement | null) => void;
};

/**
 * The window's own title bar, drawn so it is not seen: the same colour as the
 * page, no rule under it, no name and no path. It is still there, because the
 * window has to be dragged by something and the operating system draws the
 * close, minimise and maximise buttons on top of it (main/windows/chrome.ts),
 * so the gutters in `overlayGutter` stay empty for them.
 *
 * What it holds is what the whole window needs: a way back out of a record,
 * whatever the screen on show puts in its slot, the search that gets
 * anywhere, and at the right, beside the caption buttons, the agent and the
 * lock. The search sits in the middle of what is left after the caption
 * buttons, so it is not pushed off centre by whichever side has more.
 *
 * Everything here is inside the drag region except the controls, which opt out
 * with `no-drag`. A button inside a drag region does not receive clicks.
 */
export function TitleBar({
	back,
	onOpenPalette,
	lockConfigured,
	onLock,
	agentActive,
	agentPending,
	onOpenAgent,
	slotRef,
}: TitleBarProps) {
	const agentName = agentPending > 0 ? `Agent, ${agentPending} waiting for you` : "Agent";

	return (
		<header
			className="drag-region grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-2 bg-[var(--paper)]"
			style={{
				height: "var(--titlebar-height)",
				paddingLeft: overlayGutter.left,
				paddingRight: overlayGutter.right,
			}}
		>
			<div className="flex min-w-0 items-center gap-1">
				{back ? (
					<Tooltip label="Back" keys={formatCombo(COMBOS.back)} side="bottom" className="no-drag flex min-w-0">
						<button
							type="button"
							onClick={back.onSelect}
							className="animate-fade inline-flex h-7 min-w-0 items-center gap-1 rounded-[var(--radius-md)] pr-2 pl-1 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--ink-muted)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] active:scale-[0.97]"
						>
							<Icon name="chevron-left" size={16} strokeWidth={2} className="flex-none" />
							<span className="truncate">{back.label}</span>
						</button>
					</Tooltip>
				) : null}
				<div ref={slotRef} className="flex min-w-0 items-center" />
			</div>

			<button
				type="button"
				onClick={onOpenPalette}
				aria-label="Search and commands"
				className="no-drag group flex h-7 w-[min(380px,34vw)] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-left text-[length:var(--text-dense)] text-[var(--ink-muted)] transition-[border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:border-[var(--line-strong)] active:scale-[0.99]"
			>
				<Icon name="search" size={14} strokeWidth={2} className="flex-none" />
				<span className="min-w-0 flex-1 truncate">Search or jump to</span>
				<span className="hidden flex-none min-[760px]:inline-flex">
					<Kbd keys={formatCombo(COMBOS.palette)} />
				</span>
			</button>

			<nav aria-label="Window" className="flex min-w-0 items-center justify-end gap-0.5">
				{lockConfigured ? (
					<Tooltip label="Lock Juno" keys={formatCombo(COMBOS.lock)} side="bottom" className="no-drag flex">
						<button
							type="button"
							onClick={onLock}
							aria-label="Lock Juno"
							className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-faint)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] active:scale-90"
						>
							<Icon name="lock" size={16} strokeWidth={1.9} />
						</button>
					</Tooltip>
				) : null}
				<Tooltip label={agentName} keys={SCREEN_COMBOS.agent ? formatCombo(SCREEN_COMBOS.agent) : undefined} side="bottom" className="no-drag flex">
					<button
						type="button"
						data-nav="agent"
						onClick={onOpenAgent}
						aria-label={agentName}
						aria-current={agentActive ? "page" : undefined}
						className={[
							"relative flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] active:scale-90",
							agentActive ? "text-[var(--accent)]" : "text-[var(--ink-faint)] hover:text-[var(--ink)]",
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
		</header>
	);
}
