import { Icon } from "../components/Icon";
import { overlayGutter } from "../lib/platform";

type TitleBarProps = {
	/** The screen currently open, shown after the wordmark. */
	title: string;
	sidebarCollapsed: boolean;
	onToggleSidebar: () => void;
};

/**
 * The window's own title bar. The operating system still draws the close,
 * minimise and maximise buttons on top of it (main/windows/chrome.ts), so the
 * gutters in `overlayGutter` are left empty for them.
 *
 * Everything here is inside the drag region except the controls, which opt out
 * with `no-drag`. A button inside a drag region does not receive clicks.
 */
export function TitleBar({ title, sidebarCollapsed, onToggleSidebar }: TitleBarProps) {
	return (
		<header
			className="drag-region flex flex-none items-center gap-2 border-b border-[var(--line)] bg-[var(--paper)]"
			style={{
				height: "var(--titlebar-height)",
				paddingLeft: overlayGutter.left,
				paddingRight: overlayGutter.right,
			}}
		>
			<button
				type="button"
				data-sidebar-toggle
				onClick={onToggleSidebar}
				aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
				aria-pressed={!sidebarCollapsed}
				title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
				className="no-drag flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
			>
				<Icon name="sidebar" />
			</button>

			<Wordmark />

			<span className="flex-none text-[var(--ink-faint)]" aria-hidden>
				/
			</span>
			<span className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{title}
			</span>

			<div className="min-w-0 flex-1" />
		</header>
	);
}

/**
 * Juno: the crescent over the arc of the Capitoline roof. Two strokes, so it
 * stays legible at 16px and needs no separate dark variant.
 */
function Wordmark() {
	return (
		<span className="flex flex-none items-center gap-1.5">
			<svg
				viewBox="0 0 16 16"
				width="15"
				height="15"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				aria-hidden
				className="text-[var(--accent)]"
			>
				<path d="M11.2 3.1a4.6 4.6 0 1 0 1.7 7.9A5.4 5.4 0 0 1 11.2 3.1Z" />
				<path d="M2.75 13.6h10.5" />
			</svg>
			<span className="text-[length:var(--text-sm)] font-[var(--weight-semibold)] tracking-[-0.01em]">
				Juno
			</span>
		</span>
	);
}
