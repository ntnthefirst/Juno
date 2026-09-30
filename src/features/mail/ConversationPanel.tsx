import { useMemo } from "react";
import type { MailMessage, MailThreadOutgoing } from "@shared/types";
import { Icon } from "../../components/Icon";
import { layoutConversation } from "./conversation-graph";
import { displayName, formatWhen, participantsLine } from "./format";
import { STATE_LABELS, STATE_TONES } from "./outbox-format";

export type ThreadEntry =
	| { kind: "message"; message: MailMessage }
	| { kind: "outgoing"; message: MailThreadOutgoing };

type ConversationPanelProps = {
	entries: ThreadEntry[];
	/** The entry on screen. */
	openId: string | null;
	onSelect: (id: string) => void;
};

/** Every row is this tall, so the graph beside them can be drawn from the index alone. */
const ROW = 64;
const LANE = 16;
const GUTTER = 12;
const TOP = 8;
const DOT = 5;

function snippetOf(entry: ThreadEntry): string {
	if (entry.kind === "message") return entry.message.snippet;
	return entry.message.bodyText.replace(/\s+/g, " ").trim();
}

const laneX = (lane: number) => GUTTER + lane * LANE;
const rowY = (index: number) => TOP + index * ROW + ROW / 2;

/**
 * The whole conversation as a graph: what came in, what went out, and what is
 * still a draft or waiting to go. A second answer to the same mail, or a mail
 * sent on to somebody else, leaves the line as a branch. Choosing a row puts it
 * in the reading pane and changes nothing about the messages themselves.
 */
export function ConversationPanel({ entries, openId, onSelect }: ConversationPanelProps) {
	const graph = useMemo(
		() =>
			layoutConversation(
				entries.map((entry) => ({
					id: entry.message.id,
					messageId: entry.message.messageId,
					inReplyTo: entry.message.inReplyTo,
				})),
			),
		[entries],
	);
	const gutter = laneX(graph.lanes - 1) + GUTTER + DOT;
	const height = TOP * 2 + entries.length * ROW;

	return (
		<aside aria-label="Conversation" className="flex w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--paper)]">
			<h3 className="shrink-0 px-4 pb-1 pt-4 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
				Conversation
			</h3>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="relative" style={{ height }}>
					<svg aria-hidden width={gutter} height={height} className="absolute left-0 top-0">
						{graph.rows.map((row, index) => {
							if (row.parent === null) return null;
							const from = { x: laneX(graph.rows[row.parent]!.lane), y: rowY(row.parent) };
							const to = { x: laneX(row.lane), y: rowY(index) };
							const d =
								from.x === to.x
									? `M ${from.x} ${from.y} V ${to.y}`
									: `M ${from.x} ${from.y} C ${from.x} ${from.y + ROW * 0.6} ${to.x} ${to.y - ROW * 0.6} ${to.x} ${to.y}`;
							return <path key={row.id} d={d} className="fill-none stroke-[var(--line-strong)]" strokeWidth={1.5} />;
						})}
						{entries.map((entry, index) => {
							const row = graph.rows[index]!;
							const outgoing = entry.kind === "outgoing";
							const unsent = outgoing && entry.message.state !== "sent";
							const selected = entry.message.id === openId;
							return (
								<circle
									key={entry.message.id}
									cx={laneX(row.lane)}
									cy={rowY(index)}
									r={DOT}
									strokeWidth={2}
									strokeDasharray={unsent ? "2 2" : undefined}
									className={[
										outgoing ? "stroke-[var(--accent)]" : "stroke-[var(--ink-muted)]",
										selected ? (outgoing ? "fill-[var(--accent)]" : "fill-[var(--ink-muted)]") : "fill-[var(--paper)]",
									].join(" ")}
								/>
							);
						})}
					</svg>
					<ol>
						{entries.map((entry, index) => {
							const id = entry.message.id;
							const selected = id === openId;
							const outgoing = entry.kind === "outgoing";
							const name = outgoing
								? "You"
								: entry.message.from
									? displayName(entry.message.from)
									: "(unknown sender)";
							const unread = entry.kind === "message" && !entry.message.isSeen;
							const when =
								entry.kind === "message" ? (entry.message.sentAt ?? entry.message.internalDate) : entry.message.date;
							const state = outgoing ? entry.message.state : null;
							const hasAttachment =
								entry.kind === "message" ? entry.message.hasAttachments : entry.message.attachments.length > 0;
							const text = snippetOf(entry) || "(no text)";

							return (
								<li key={id} style={{ height: ROW, marginTop: index === 0 ? TOP : 0 }}>
									<button
										type="button"
										aria-current={selected ? "true" : undefined}
										onClick={() => onSelect(id)}
										style={{ paddingLeft: gutter + 8 }}
										className={[
											"flex h-full w-full flex-col justify-center gap-0.5 pr-4 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
											"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]",
											selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
										].join(" ")}
									>
										<span className="flex items-center gap-2 text-[length:var(--text-dense)]">
											<Icon
												name={outgoing ? "sent" : "inbox"}
												size={12}
												className={outgoing ? "shrink-0 text-[var(--accent)]" : "shrink-0 text-[var(--ink-muted)]"}
											/>
											<span
												className={`truncate ${unread ? "font-[var(--weight-semibold)]" : "font-[var(--weight-medium)]"}`}
											>
												{name}
											</span>
											{unread ? (
												<span aria-label="Unread" className="size-1.5 shrink-0 rounded-[var(--radius-full)] bg-[var(--accent)]" />
											) : null}
											{hasAttachment ? (
												<Icon name="attachment" size={12} className="shrink-0 text-[var(--ink-muted)]" />
											) : null}
											<span className="tabular ml-auto shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												{formatWhen(when)}
											</span>
										</span>
										{outgoing ? (
											<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												To {participantsLine(entry.message.to)}
											</span>
										) : null}
										<span className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{state !== null && state !== "sent" ? (
												<span
													className={`shrink-0 rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-micro)] ${STATE_TONES[state]}`}
												>
													{STATE_LABELS[state]}
												</span>
											) : null}
											<span className="truncate">{text}</span>
										</span>
									</button>
								</li>
							);
						})}
					</ol>
				</div>
			</div>
		</aside>
	);
}
