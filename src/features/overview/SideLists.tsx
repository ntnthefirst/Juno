import { useMemo, type ReactNode } from "react";
import type { ClientSummary, DocumentRecord, MailThreadSummary, ReferenceItem } from "@shared/types";
import { Avatar } from "../../components/Avatar";
import { CardHeader } from "../../components/CardHeader";
import { requestOpenClient } from "../../lib/open-client";
import { requestOpen } from "../../lib/open-entity";
import type { Loaded } from "../../lib/use-loaded";
import { belongsTo } from "../documents/belongs-to";
import { formatWhen, leadParticipant } from "../mail/format";

const SHOWN = 5;

type ListRowProps = {
	name: string;
	shape: "round" | "square";
	title: string;
	meta: string;
	trailing?: string;
	onClick: () => void;
};

function ListRow({ name, shape, title, meta, trailing, onClick }: ListRowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex min-h-12 w-full items-center gap-3 py-2 text-left transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] hover:opacity-70"
		>
			<Avatar name={name} size={28} shape={shape} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-base">{title}</span>
				<span className="block truncate text-sm text-ink-muted">{meta || " "}</span>
			</span>
			{trailing ? <span className="flex-none text-dense tabular-nums text-ink-muted">{trailing}</span> : null}
		</button>
	);
}

type BlockProps = {
	/** The read failed, so the block says so and the rest of the column stays. */
	state: Loaded<unknown>;
	what: string;
	empty: string;
	isEmpty: boolean;
	children: ReactNode;
};

function Block({ state, what, empty, isEmpty, children }: BlockProps) {
	if (state.status === "error") {
		return (
			<p data-selectable className="border-l-2 border-risk pl-3 text-dense text-risk">
				Could not load {what}. {state.message}
			</p>
		);
	}
	if (state.status === "loading") {
		return (
			<div role="status" aria-label="Loading" className="flex flex-col">
				{[0, 1].map((row) => (
					<div key={row} className="flex h-12 items-center gap-3">
						<span className="h-7 w-7 animate-pulse rounded-[var(--radius-full)] bg-sunken" />
						<span className="h-3 w-1/2 animate-pulse rounded-[var(--radius-sm)] bg-sunken" />
					</div>
				))}
			</div>
		);
	}
	return isEmpty ? <p className="py-1 text-base text-ink-muted">{empty}</p> : <>{children}</>;
}

type SideListsProps = {
	unread: Loaded<MailThreadSummary[]>;
	unreadCount: number | null;
	documents: Loaded<DocumentRecord[]>;
	statuses: ReferenceItem[];
	clients: Loaded<ClientSummary[]>;
	hasAccounts: boolean | null;
};

/** The right edge: what is unread, the documents touched last, and the clients with news. */
export function SideLists({ unread, unreadCount, documents, statuses, clients, hasAccounts }: SideListsProps) {
	const threads = useMemo(() => (unread.status === "ready" ? unread.value.slice(0, SHOWN) : []), [unread]);
	const recentDocuments = useMemo(
		() =>
			documents.status === "ready"
				? [...documents.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, SHOWN)
				: [],
		[documents],
	);
	const recentClients = useMemo(
		() =>
			clients.status === "ready"
				? [...clients.value].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, SHOWN)
				: [],
		[clients],
	);
	const statusOf = useMemo(() => new Map(statuses.map((item) => [item.id, item])), [statuses]);
	const open = (screen: "mail" | "documents" | "clients") => () => requestOpen({ kind: "screen", screen });

	return (
		<div className="flex flex-col gap-8">
			<section>
				<CardHeader title="Unread mail" count={unreadCount ?? undefined} link={{ label: "Mail", onClick: open("mail") }} />
				<Block
					state={unread}
					what="your mail"
					isEmpty={threads.length === 0}
					empty={hasAccounts === false ? "No mail account is connected yet." : "You are up to date."}
				>
					{threads.map((thread) => {
						const sender = leadParticipant(thread.participants);
						return (
							<ListRow
								key={thread.id}
								name={sender}
								shape="round"
								title={sender}
								meta={thread.subject}
								trailing={formatWhen(thread.lastMessageAt)}
								onClick={() => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId })}
							/>
						);
					})}
				</Block>
			</section>

			<section>
				<CardHeader title="Documents" link={{ label: "All documents", onClick: open("documents") }} />
				<Block
					state={documents}
					what="your documents"
					isEmpty={recentDocuments.length === 0}
					empty="Documents you generate or import are listed here."
				>
					{recentDocuments.map((record) => (
						<ListRow
							key={record.id}
							name={record.clientName ?? record.projectName ?? record.title}
							shape="square"
							title={record.title}
							meta={belongsTo(record)}
							trailing={record.statusId ? statusOf.get(record.statusId)?.label : undefined}
							onClick={() => requestOpen({ kind: "document", id: record.id, name: record.title })}
						/>
					))}
				</Block>
			</section>

			<section>
				<CardHeader title="Clients" link={{ label: "All clients", onClick: open("clients") }} />
				<Block
					state={clients}
					what="your clients"
					isEmpty={recentClients.length === 0}
					empty="Clients you add are listed here."
				>
					{recentClients.map((client) => (
						<ListRow
							key={client.id}
							name={client.name}
							shape="square"
							title={client.name}
							meta={[client.city, client.status?.label].filter(Boolean).join(" · ")}
							trailing={client.openProjectCount > 0 ? `${client.openProjectCount} open` : undefined}
							onClick={() => requestOpenClient(client.id, client.name)}
						/>
					))}
				</Block>
			</section>
		</div>
	);
}
