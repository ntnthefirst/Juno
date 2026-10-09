import { useMemo } from "react";
import type { ClientSummary } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { groupByDay } from "../../lib/day-groups";
import { requestOpenClient } from "../../lib/open-client";
import { requestOpen } from "../../lib/open-entity";
import type { Loaded } from "../../lib/use-loaded";
import { Card, CardError, CardLink, CardNote, GroupLabel, CardSkeleton } from "./Card";

type ClientsCardProps = {
	clients: Loaded<ClientSummary[]>;
};

const SHOWN = 5;

/** The clients something happened with last: a project, a document, a note. */
export function ClientsCard({ clients }: ClientsCardProps) {
	const recent = useMemo(
		() =>
			clients.status === "ready"
				? [...clients.value].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, SHOWN)
				: [],
		[clients],
	);
	const groups = useMemo(() => groupByDay(recent, (client) => client.lastActivityAt), [recent]);

	return (
		<Card
			title="Clients"
			action={<CardLink label="All clients" onClick={() => requestOpen({ kind: "screen", screen: "clients" })} />}
		>
			<CardError what="your clients" state={clients} />
			{clients.status === "loading" ? (
				<CardSkeleton />
			) : clients.status === "ready" && recent.length === 0 ? (
				<CardNote>No clients yet.</CardNote>
			) : (
				groups.map((group) => (
					<div key={group.key}>
						<GroupLabel>{group.label}</GroupLabel>
						{group.items.map((client) => (
							<button
								key={client.id}
								type="button"
								onClick={() => requestOpenClient(client.id, client.name)}
								className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
							>
								<Avatar name={client.name} size={32} shape="square" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[length:var(--text-base)]">{client.name}</span>
									<span className="block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{[client.city, client.status?.label].filter(Boolean).join(" · ") || " "}
									</span>
								</span>
								{client.openProjectCount > 0 ? (
									<span className="tabular flex-none text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{client.openProjectCount} open
									</span>
								) : null}
							</button>
						))}
					</div>
				))
			)}
		</Card>
	);
}
