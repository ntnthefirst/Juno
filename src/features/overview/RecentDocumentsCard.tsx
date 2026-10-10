import { useMemo } from "react";
import type { DocumentRecord, ReferenceItem } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { StatusBadge } from "../../components/StatusBadge";
import { groupByDay } from "../../lib/day-groups";
import { requestOpen } from "../../lib/open-entity";
import type { Loaded } from "../../lib/use-loaded";
import { Card, CardError, CardLink, CardNote, GroupLabel, CardSkeleton } from "./Card";
import { belongsTo } from "../documents/belongs-to";

type RecentDocumentsCardProps = {
	documents: Loaded<DocumentRecord[]>;
	statuses: ReferenceItem[];
};

const SHOWN = 6;

/** The documents touched last, split by day, each with the client it is for. */
export function RecentDocumentsCard({ documents, statuses }: RecentDocumentsCardProps) {
	const recent = useMemo(
		() =>
			documents.status === "ready"
				? [...documents.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, SHOWN)
				: [],
		[documents],
	);
	const groups = useMemo(() => groupByDay(recent, (record) => record.updatedAt), [recent]);
	const statusOf = useMemo(() => new Map(statuses.map((item) => [item.id, item])), [statuses]);

	return (
		<Card
			title="Documents"
			action={<CardLink label="All documents" onClick={() => requestOpen({ kind: "screen", screen: "documents" })} />}
		>
			<CardError what="your documents" state={documents} />
			{documents.status === "loading" ? (
				<CardSkeleton />
			) : documents.status === "ready" && recent.length === 0 ? (
				<CardNote>No documents yet.</CardNote>
			) : (
				groups.map((group) => (
					<div key={group.key}>
						<GroupLabel>{group.label}</GroupLabel>
						{group.items.map((record) => {
							const status = record.statusId ? statusOf.get(record.statusId) : undefined;
							return (
								<button
									key={record.id}
									type="button"
									onClick={() => requestOpen({ kind: "document", id: record.id, name: record.title })}
									className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
								>
									<Avatar name={record.clientName ?? record.projectName ?? record.title} size={32} shape="square" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[length:var(--text-base)]">{record.title}</span>
										<span className="block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{belongsTo(record)}
										</span>
									</span>
									{status ? <StatusBadge label={status.label} tone={status.tone} /> : null}
								</button>
							);
						})}
					</div>
				))
			)}
		</Card>
	);
}
