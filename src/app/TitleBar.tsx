import { useState } from "react";
import type { Reminder } from "@shared/types";
import { Icon } from "../components/Icon";
import { overlayGutter } from "../lib/platform";
import type { Crumb } from "./breadcrumb-context";

type TitleBarProps = {
	/** The screen currently open, shown after the wordmark when nothing deeper is. */
	title: string;
	/**
	 * Where you are inside that screen, when a record is open full screen. The
	 * screen publishes it through `usePublishBreadcrumb`, starting with its own
	 * name, and every step but the last goes back to what it names.
	 */
	trail: Crumb[];
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
	trail,
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

			<Trail
				title={title}
				trail={trail}
			/>

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

type TrailProps = {
	title: string;
	trail: Crumb[];
};

/**
 * `Juno / Clients / Jansen BV`. A record opens over the whole working area, so
 * this line is the only thing saying which record it is, and the only way back
 * that is not the sidebar.
 *
 * The steps shrink before the last one does: on a narrow window the client's
 * name stays readable and `Clients` truncates instead.
 */
function Trail({ title, trail }: TrailProps) {
	const steps: Crumb[] = trail.length === 0 ? [{ label: title }] : trail;

	return (
		<nav
			aria-label="Location"
			className="flex min-w-0 items-center"
		>
			{steps.map((step, index) => {
				const last = index === steps.length - 1;

				return (
					<span
						key={`${index}:${step.label}`}
						className={`flex items-center ${last ? "min-w-0 shrink-[1]" : "min-w-0 shrink-[4]"}`}
					>
						<span
							className="flex-none px-2 text-[var(--ink-faint)]"
							aria-hidden
						>
							/
						</span>
						{step.onSelect && !last ? (
							<button
								type="button"
								onClick={step.onSelect}
								className="no-drag min-w-0 truncate rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
							>
								{step.label}
							</button>
						) : (
							<span
								aria-current={last ? "page" : undefined}
								className={`min-w-0 truncate text-[length:var(--text-sm)] ${
									last ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
								}`}
							>
								{step.label}
							</span>
						)}
					</span>
				);
			})}
		</nav>
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
