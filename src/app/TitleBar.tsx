import { Icon } from "../components/Icon";
import { Kbd } from "../components/Kbd";
import { Tooltip } from "../components/Tooltip";
import { overlayGutter } from "../lib/platform";
import { COMBOS, formatCombo } from "../lib/shortcuts";

type TitleBarProps = {
	/**
	 * Where back goes, when a record is open over its list: the name of that list
	 * and the way there. Null at the top of a screen, where there is nowhere to go.
	 */
	back: { label: string; onSelect: () => void } | null;
	onOpenPalette: () => void;
	lockConfigured: boolean;
	onLock: () => void;
};

/**
 * The window's own title bar. The operating system still draws the close,
 * minimise and maximise buttons on top of it (main/windows/chrome.ts), so the
 * gutters in `overlayGutter` are left empty for them.
 *
 * It carries no name and no path. The sidebar says where you are, the page says
 * what it is, and a bar that repeated both was a line of text nobody read. What
 * it holds is what the whole window needs: a way back out of a record, the
 * search that gets anywhere, and the lock. The search sits in the middle of
 * what is left after the caption buttons, so it is not pushed off centre by
 * whichever side has more.
 *
 * Everything here is inside the drag region except the controls, which opt out
 * with `no-drag`. A button inside a drag region does not receive clicks.
 */
export function TitleBar({ back, onOpenPalette, lockConfigured, onLock }: TitleBarProps) {
	return (
		<header
			className="drag-region grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-[var(--line)] bg-[var(--paper)]"
			style={{
				height: "var(--titlebar-height)",
				paddingLeft: overlayGutter.left,
				paddingRight: overlayGutter.right,
			}}
		>
			<div className="flex min-w-0 items-center">
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

			<div className="flex min-w-0 items-center justify-end">
				{lockConfigured ? (
					<Tooltip label="Lock Juno" keys={formatCombo(COMBOS.lock)} side="bottom" className="no-drag flex">
						<button
							type="button"
							onClick={onLock}
							aria-label="Lock Juno"
							className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-faint)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] active:scale-90"
						>
							<Icon name="lock" size={16} strokeWidth={1.9} />
						</button>
					</Tooltip>
				) : null}
			</div>
		</header>
	);
}
