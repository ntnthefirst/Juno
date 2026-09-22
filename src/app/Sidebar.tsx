import { Icon, type IconName } from "../components/Icon";
import { SCREEN_GROUPS, type ScreenId } from "./screens";

type SidebarProps = {
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
	/** Icons only. Labels move into the tooltip and the accessible name. */
	collapsed: boolean;
	/** Floating over the content on a narrow window, rather than beside it. */
	floating: boolean;
	onOpenSettings: () => void;
	lockConfigured: boolean;
};

export function Sidebar({ current, onNavigate, collapsed, floating, onOpenSettings, lockConfigured }: SidebarProps) {
	const width = collapsed ? "var(--sidebar-rail-width)" : "var(--sidebar-width)";

	return (
		<nav
			aria-label="Sections"
			style={{ width }}
			className={[
				"flex flex-none flex-col bg-[var(--paper)] transition-[width] duration-[var(--duration-base)] ease-[var(--ease)]",
				floating
					? "absolute inset-y-0 left-0 z-20 shadow-[var(--shadow-drawer)]"
					: "border-r border-[var(--line)]",
				collapsed ? "px-2" : "px-3",
			].join(" ")}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto py-3">
				{SCREEN_GROUPS.map((group, index) => (
					<div
						key={group.heading ?? "start"}
						className="flex flex-col gap-px"
					>
						{group.heading ? (
							<GroupHeading
								collapsed={collapsed}
								first={index === 0}
							>
								{group.heading}
							</GroupHeading>
						) : null}
						{group.items.map((item) => (
							<NavButton
								key={item.id}
								navId={item.id}
								icon={item.icon}
								label={item.label}
								active={item.id === current}
								collapsed={collapsed}
								onClick={() => onNavigate(item.id)}
							/>
						))}
					</div>
				))}
			</div>

			<div className="flex flex-none flex-col gap-px border-t border-[var(--line)] py-2">
				{lockConfigured ? (
					<NavButton
						navId="lock"
						icon="lock"
						label="Lock"
						active={false}
						collapsed={collapsed}
						onClick={() => void window.juno.lock.lock()}
					/>
				) : null}
				<NavButton
					navId="settings"
					icon="settings"
					label="Settings"
					active={false}
					collapsed={collapsed}
					onClick={onOpenSettings}
				/>
			</div>
		</nav>
	);
}

type GroupHeadingProps = {
	collapsed: boolean;
	first: boolean;
	children: string;
};

function GroupHeading({ collapsed, first, children }: GroupHeadingProps) {
	// Collapsed, a word does not fit and an abbreviation reads worse than
	// nothing. A hairline keeps the grouping visible without the label.
	if (collapsed) {
		return (
			<div
				className="mx-2 my-2 border-t border-[var(--line)]"
				aria-hidden
			/>
		);
	}
	return (
		<div
			className={[
				"px-3 pb-1 text-[length:var(--text-micro)] uppercase tracking-[0.08em] text-[var(--ink-faint)]",
				first ? "pt-2" : "pt-4",
			].join(" ")}
		>
			{children}
		</div>
	);
}

type NavButtonProps = {
	/**
	 * A stable hook for the smoke run, which cannot match on the label: a
	 * collapsed sidebar renders no text, and that is exactly the state a narrow
	 * CI display puts it in.
	 */
	navId: string;
	icon: IconName;
	label: string;
	active: boolean;
	collapsed: boolean;
	/** Shown when more than zero. Nothing else in the sidebar counts. */
	badge?: number;
	onClick: () => void;
};

function NavButton({ navId, icon, label, active, collapsed, badge = 0, onClick }: NavButtonProps) {
	return (
		<button
			type="button"
			data-nav={navId}
			aria-current={active ? "page" : undefined}
			aria-label={collapsed ? label : undefined}
			title={collapsed ? label : undefined}
			onClick={onClick}
			style={{ height: "var(--row-height)" }}
			className={[
				"relative flex w-full items-center rounded-[var(--radius-md)] text-left transition-colors",
				collapsed ? "justify-center px-0" : "gap-3 px-3",
				active
					? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<Icon
				name={icon}
				className="flex-none"
			/>
			{collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
			{badge > 0 ? (
				<span
					className={[
						"tabular flex-none rounded-[var(--radius-full)] bg-[var(--warn-soft)] text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--warn)]",
						collapsed ? "absolute right-1 top-1 min-w-[15px] px-1 text-center leading-[15px]" : "px-1.5",
					].join(" ")}
					aria-label={`${badge} waiting for you`}
				>
					{badge}
				</span>
			) : null}
		</button>
	);
}
