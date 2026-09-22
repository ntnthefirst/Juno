import { useState } from "react";
import type { Reminder } from "@shared/types";
import { Icon } from "../components/Icon";
import { overlayGutter } from "../lib/platform";

type TitleBarProps = {
	/** The screen currently open, shown after the wordmark. */
	title: string;
	sidebarCollapsed: boolean;
	onToggleSidebar: () => void;
	onOpenReminders: () => void;
	lockConfigured: boolean;
	onLock: () => void;
};

/**
 * The window's own title bar. The operating system still draws the close,
 * minimise and maximise buttons on top of it (main/windows/chrome.ts), so the
 * gutters in `overlayGutter` are left empty for them.
 *
 * Everything here is inside the drag region except the controls, which opt out
 * with `no-drag`. A button inside a drag region does not receive clicks.
 */
export function TitleBar({
	title,
	sidebarCollapsed,
	onToggleSidebar,
	onOpenReminders,
	lockConfigured,
	onLock,
}: TitleBarProps) {
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

			<span
				className="flex-none text-[var(--ink-faint)]"
				aria-hidden
			>
				/
			</span>
			<span className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{title}</span>

			<div className="min-w-0 flex-1" />

			<ReminderMenu onOpen={onOpenReminders} />
			{lockConfigured ? (
				<button
					type="button"
					onClick={onLock}
					aria-label="Lock Juno"
					title="Lock Juno"
					className="no-drag flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon name="lock" />
				</button>
			) : null}
		</header>
	);
}

type ReminderMenuProps = {
	onOpen: () => void;
};

function ReminderMenu({ onOpen }: ReminderMenuProps) {
	const [open, setOpen] = useState(false);
	const [rows, setRows] = useState<Reminder[] | null>(null);

	async function show() {
		setOpen(true);
		try {
			setRows(await window.juno.reminders.list({ actionableOnly: true }));
		} catch {
			setRows([]);
		}
	}

	function openAll() {
		setOpen(false);
		onOpen();
	}

	return (
		<div className="relative no-drag">
			<button
				type="button"
				aria-label="Show reminders"
				aria-expanded={open}
				title="Show reminders"
				onClick={() => (open ? setOpen(false) : void show())}
				className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
			>
				<Icon name="reminders" />
				{rows && rows.length > 0 ? (
					<span className="tabular text-[length:var(--text-micro)]">{rows.length}</span>
				) : null}
			</button>

			{open ? (
				<div className="absolute right-0 top-10 z-30 w-[280px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]">
					<div className="flex items-center justify-between gap-3">
						<h2 className="text-[length:var(--text-sm)] font-[var(--weight-semibold)]">Reminders</h2>
						<button
							type="button"
							onClick={openAll}
							className="text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--accent)] hover:text-[var(--accent-hover)]"
						>
							View all
						</button>
					</div>
					{rows === null ? (
						<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Loading.</p>
					) : rows.length === 0 ? (
						<p className="mt-3 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Nothing needs your attention.
						</p>
					) : (
						<ul className="mt-2 divide-y divide-[var(--line)]">
							{rows.slice(0, 4).map((reminder) => (
								<li
									key={reminder.id}
									className="py-2 first:pt-1 last:pb-1"
								>
									<p className="truncate text-[length:var(--text-sm)]">{reminder.title}</p>
									<p className="tabular mt-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
										Due {reminder.dueOn}
									</p>
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}
		</div>
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
			<span className="text-[length:var(--text-sm)] font-[var(--weight-semibold)] tracking-[-0.01em]">Juno</span>
		</span>
	);
}
