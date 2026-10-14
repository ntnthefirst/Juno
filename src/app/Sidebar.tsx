import { Icon, type IconName } from "../components/Icon";
import { Tooltip } from "../components/Tooltip";
import { COMBOS, SCREEN_COMBOS, formatCombo } from "../lib/shortcuts";
import { SIDEBAR_TOP, type ScreenId } from "./screens";

type SidebarProps = {
	/** The entry to light. A screen without an entry of its own lights the one it belongs to. */
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
	onOpenSettings: () => void;
};

/**
 * A rail of icons, always, sized like a code editor's activity bar: 48px wide,
 * 48px per entry, 24px icons. It never opens: the names are in the tooltips,
 * and the only states an entry has are its colour, soft at rest, firmer under
 * the pointer and iris once it is the page you are on. No fill and no outline
 * mark any of the three. The ring a keyboard user needs is the one global
 * `:focus-visible` rule, which a mouse click never triggers.
 *
 * The agent is not here. It is about Juno rather than a place the work
 * happens, so it sits in the title bar beside the window's own buttons.
 */
export function Sidebar({ current, onNavigate, onOpenSettings }: SidebarProps) {
	return (
		<nav
			aria-label="Sections"
			data-sidebar
			style={{ width: "var(--sidebar-rail-width)" }}
			className="flex flex-none flex-col items-stretch border-r border-[var(--line)] bg-[var(--paper)]"
		>
			<div className="flex min-h-0 w-full flex-1 flex-col">
				{SIDEBAR_TOP.map((item) => (
					<NavButton
						key={item.id}
						navId={item.id}
						icon={item.icon}
						label={item.label}
						active={item.id === current}
						combo={SCREEN_COMBOS[item.id]}
						onClick={() => onNavigate(item.id)}
					/>
				))}
			</div>

			<div className="flex w-full flex-none flex-col">
				<NavButton
					navId="settings"
					icon="settings"
					label="Settings"
					active={false}
					combo={COMBOS.settings}
					onClick={onOpenSettings}
				/>
			</div>
		</nav>
	);
}

type NavButtonProps = {
	/**
	 * A stable hook for the smoke run and the walkthrough. The rail renders no
	 * text, so neither can match on a label.
	 */
	navId: string;
	icon: IconName;
	label: string;
	active: boolean;
	/** The shortcut, drawn in the tooltip. */
	combo?: string | undefined;
	onClick: () => void;
};

function NavButton({ navId, icon, label, active, combo, onClick }: NavButtonProps) {
	return (
		<Tooltip label={label} keys={combo ? formatCombo(combo) : undefined} className="flex w-full">
			<button
				type="button"
				data-nav={navId}
				aria-current={active ? "page" : undefined}
				aria-label={label}
				onClick={onClick}
				className={[
					"relative flex h-12 w-full items-center justify-center transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
					active ? "text-[var(--accent)]" : "text-[var(--ink-faint)] hover:text-[var(--ink)]",
				].join(" ")}
			>
				<Icon name={icon} size={24} strokeWidth={1.7} />
			</button>
		</Tooltip>
	);
}
