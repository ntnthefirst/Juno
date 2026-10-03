import type { ReactNode } from "react";
import type { ScreenId } from "../../app/screens";
import { Icon, type IconName } from "../../components/Icon";
import { requestOpen } from "../../lib/open-entity";

type Stat = {
	label: string;
	icon: IconName;
	/** Null while it is still being counted. */
	value: number | null;
	screen: ScreenId;
	/** The classes of the tone the icon sits in. Static strings, so Tailwind sees them. */
	tone: string;
};

type StatTilesProps = {
	clients: number | null;
	projects: number | null;
	documents: number | null;
	unread: number | null;
};

/**
 * Four counts and a way into each. They answer "how big is this" at a glance,
 * and a press goes to the screen that holds the records, which is the one
 * thing the removed sidebar groups used to be for.
 */
export function StatTiles({ clients, projects, documents, unread }: StatTilesProps) {
	const stats: Stat[] = [
		{ label: "Clients", icon: "clients", value: clients, screen: "clients", tone: "bg-tone-1 text-tone-1-ink" },
		{ label: "Projects", icon: "projects", value: projects, screen: "projects", tone: "bg-tone-3 text-tone-3-ink" },
		{ label: "Documents", icon: "documents", value: documents, screen: "documents", tone: "bg-tone-5 text-tone-5-ink" },
		{ label: "Unread mail", icon: "mail", value: unread, screen: "mail", tone: "bg-tone-2 text-tone-2-ink" },
	];

	return (
		<div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
			{stats.map((stat) => (
				<StatTile key={stat.label} stat={stat}>
					{stat.value === null ? "-" : stat.value}
				</StatTile>
			))}
		</div>
	);
}

type StatTileProps = {
	stat: Stat;
	children: ReactNode;
};

function StatTile({ stat, children }: StatTileProps) {
	return (
		<button
			type="button"
			onClick={() => requestOpen({ kind: "screen", screen: stat.screen })}
			className="group flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:border-[var(--line-strong)]"
		>
			<span
				aria-hidden
				className={`flex h-9 w-9 flex-none items-center justify-center rounded-[var(--radius-md)] ${stat.tone}`}
			>
				<Icon name={stat.icon} size={18} strokeWidth={1.9} />
			</span>
			<span className="min-w-0">
				<span className="tabular block text-[length:var(--text-h3)] font-[var(--weight-semibold)] leading-tight">
					{children}
				</span>
				<span className="block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{stat.label}</span>
			</span>
		</button>
	);
}
