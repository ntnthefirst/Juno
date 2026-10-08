import type { ScreenId } from "../../app/screens";
import { Icon, type IconName } from "../../components/Icon";
import { requestOpen } from "../../lib/open-entity";
import { stagger, useCountUp } from "../../lib/motion";

type Stat = {
	label: string;
	icon: IconName;
	/** Null while it is still being counted. */
	value: number | null;
	screen: ScreenId;
};

type StatTilesProps = {
	clients: number | null;
	projects: number | null;
	documents: number | null;
	unread: number | null;
};

/**
 * Four counts and a way into each. They answer "how big is this" at a glance,
 * and a press goes to the screen that holds the records. Plain on purpose: the
 * number is the thing, so there is no colour in the tile to compete with it.
 */
export function StatTiles({ clients, projects, documents, unread }: StatTilesProps) {
	const stats: Stat[] = [
		{ label: "Clients", icon: "clients", value: clients, screen: "clients" },
		{ label: "Projects", icon: "projects", value: projects, screen: "projects" },
		{ label: "Documents", icon: "documents", value: documents, screen: "documents" },
		{ label: "Unread mail", icon: "mail", value: unread, screen: "mail" },
	];

	return (
		<div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
			{stats.map((stat, index) => (
				<StatTile key={stat.label} stat={stat} index={index} />
			))}
		</div>
	);
}

type StatTileProps = {
	stat: Stat;
	index: number;
};

function StatTile({ stat, index }: StatTileProps) {
	const counted = useCountUp(stat.value);

	return (
		<button
			type="button"
			onClick={() => requestOpen({ kind: "screen", screen: stat.screen })}
			style={stagger(index)}
			className="group animate-rise flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition-[border-color,transform] duration-[var(--duration-base)] ease-[var(--ease-smooth)] hover:-translate-y-px hover:border-[var(--line-strong)] active:translate-y-0 active:scale-[0.99]"
		>
			<span className="flex items-center gap-2 text-[var(--ink-muted)]">
				<Icon name={stat.icon} size={15} strokeWidth={1.9} />
				<span className="text-[length:var(--text-dense)]">{stat.label}</span>
			</span>
			<span className="tabular text-[length:var(--text-h2)] font-[var(--weight-semibold)] leading-none tracking-[-0.02em]">
				{counted === null ? "-" : counted}
			</span>
		</button>
	);
}
