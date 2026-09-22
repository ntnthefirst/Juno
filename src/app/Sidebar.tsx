export type ScreenId =
	| "today"
	| "clients"
	| "projects"
	| "documents"
	| "mail"
	| "calendar"
	| "reminders"
	| "agent"
	| "templates"
	| "settings";

type Item = { id: ScreenId; label: string };

const PRIMARY: Item[] = [
	{ id: "today", label: "Today" },
	{ id: "clients", label: "Clients" },
	{ id: "projects", label: "Projects" },
	{ id: "documents", label: "Documents" },
	{ id: "mail", label: "Mail" },
	{ id: "calendar", label: "Calendar" },
	{ id: "reminders", label: "Reminders" },
	{ id: "agent", label: "Agent" },
];

const SECONDARY: Item[] = [
	{ id: "templates", label: "Templates" },
	{ id: "settings", label: "Settings" },
];

/**
 * No panel fill and no card, per brand/BRAND.md section 7: a container has to be
 * earned, and a list of links has not earned one. Space and a single divider.
 */
type SidebarProps = {
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
	/** How many agent requests are waiting, for the badge. */
	pendingActions: number;
};

export function Sidebar({ current, onNavigate, pendingActions }: SidebarProps) {
	return (
		<nav
			className="flex flex-none flex-col gap-px border-r border-[var(--line)] px-3 py-5"
			style={{ width: "var(--sidebar-width)" }}
			aria-label="Sections"
		>
			{PRIMARY.map((item) => (
				<NavButton
					key={item.id}
					item={item}
					current={current}
					onNavigate={onNavigate}
					badge={item.id === "agent" ? pendingActions : 0}
				/>
			))}

			<div className="px-3 pt-4 pb-2 text-[length:var(--text-micro)] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
				Setup
			</div>

			{SECONDARY.map((item) => (
				<NavButton key={item.id} item={item} current={current} onNavigate={onNavigate} />
			))}
		</nav>
	);
}

type NavButtonProps = {
	item: Item;
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
	/** Shown when more than zero. Nothing else in the sidebar counts. */
	badge?: number;
};

function NavButton({ item, current, onNavigate, badge = 0 }: NavButtonProps) {
	const active = item.id === current;
	return (
		<button
			type="button"
			aria-current={active ? "page" : undefined}
			onClick={() => onNavigate(item.id)}
			style={{ height: "var(--row-height)" }}
			className={[
				"flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left transition-colors",
				active
					? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
			].join(" ")}
		>
			<span className="h-1.5 w-1.5 flex-none rounded-full bg-current opacity-55" aria-hidden />
			<span className="min-w-0 flex-1 truncate">{item.label}</span>
			{badge > 0 ? (
				<span
					className="tabular flex-none rounded-[var(--radius-full)] bg-[var(--warn-soft)] px-1.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--warn)]"
					aria-label={`${badge} waiting for you`}
				>
					{badge}
				</span>
			) : null}
		</button>
	);
}
