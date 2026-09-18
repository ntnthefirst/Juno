export type ScreenId =
	| "today"
	| "clients"
	| "projects"
	| "documents"
	| "mail"
	| "calendar"
	| "reminders"
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
];

const SECONDARY: Item[] = [
	{ id: "templates", label: "Templates" },
	{ id: "settings", label: "Settings" },
];

/**
 * No panel fill and no card, per brand/BRAND.md section 7: a container has to be
 * earned, and a list of links has not earned one. Space and a single divider.
 */
export function Sidebar({
	current,
	onNavigate,
}: {
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
}) {
	return (
		<nav
			className="flex flex-none flex-col gap-px border-r border-[var(--line)] px-3 py-5"
			style={{ width: "var(--sidebar-width)" }}
			aria-label="Sections"
		>
			{PRIMARY.map((item) => (
				<NavButton key={item.id} item={item} current={current} onNavigate={onNavigate} />
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

function NavButton({
	item,
	current,
	onNavigate,
}: {
	item: Item;
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
}) {
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
			{item.label}
		</button>
	);
}
