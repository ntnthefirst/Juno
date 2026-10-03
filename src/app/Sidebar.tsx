import { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Tooltip } from "../components/Tooltip";
import { SIDEBAR_BOTTOM, SIDEBAR_TOP, type ScreenId } from "./screens";

type SidebarProps = {
	/** The entry to light. A screen without an entry of its own lights the one it belongs to. */
	current: ScreenId;
	onNavigate: (id: ScreenId) => void;
	onOpenSettings: () => void;
};

/**
 * A rail of icons, always. It never opens: the names are in the tooltips, and
 * the only states an entry has are its colour, soft at rest, firmer under the
 * pointer and iris once it is the page you are on. No fill and no outline
 * mark any of the three. The ring a keyboard user needs is the one global
 * `:focus-visible` rule, which a mouse click never triggers.
 */
export function Sidebar({ current, onNavigate, onOpenSettings }: SidebarProps) {
	const [pending, setPending] = useState(0);

	useEffect(() => {
		const refresh = () => {
			void window.juno.agent.actions
				.pendingCount()
				.then(setPending)
				.catch(() => setPending(0));
		};
		refresh();
		return window.juno.agent.actions.onChange(refresh);
	}, []);

	return (
		<nav
			aria-label="Sections"
			data-sidebar
			style={{ width: "var(--sidebar-rail-width)" }}
			className="flex flex-none flex-col items-center border-r border-[var(--line)] bg-[var(--paper)] px-2 py-3"
		>
			<div className="flex min-h-0 w-full flex-1 flex-col gap-1">
				{SIDEBAR_TOP.map((item) => (
					<NavButton
						key={item.id}
						navId={item.id}
						icon={item.icon}
						label={item.label}
						active={item.id === current}
						onClick={() => onNavigate(item.id)}
					/>
				))}
			</div>

			<div className="flex w-full flex-none flex-col gap-1">
				{SIDEBAR_BOTTOM.map((item) => (
					<NavButton
						key={item.id}
						navId={item.id}
						icon={item.icon}
						label={item.label}
						active={item.id === current}
						badge={item.id === "agent" ? pending : 0}
						onClick={() => onNavigate(item.id)}
					/>
				))}
				<NavButton
					navId="settings"
					icon="settings"
					label="Settings"
					active={false}
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
	/** A dot when more than zero, and the count in the name. Nothing else here counts. */
	badge?: number;
	onClick: () => void;
};

function NavButton({ navId, icon, label, active, badge = 0, onClick }: NavButtonProps) {
	const name = badge > 0 ? `${label}, ${badge} waiting for you` : label;

	return (
		<Tooltip label={name} className="flex w-full">
			<button
				type="button"
				data-nav={navId}
				aria-current={active ? "page" : undefined}
				aria-label={name}
				onClick={onClick}
				className={[
					"relative flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
					active ? "text-[var(--accent)]" : "text-[var(--ink-faint)] hover:text-[var(--ink)]",
				].join(" ")}
			>
				<Icon name={icon} size={20} strokeWidth={2} />
				{badge > 0 ? (
					<span
						aria-hidden
						className="absolute right-[9px] top-[9px] h-2 w-2 rounded-[var(--radius-full)] bg-[var(--warn)] ring-2 ring-[var(--paper)]"
					/>
				) : null}
			</button>
		</Tooltip>
	);
}
