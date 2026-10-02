import { useMemo } from "react";
import type { MailMessage, MailThreadOutgoing } from "@shared/types";
import { Icon } from "../../components/Icon";
import { layoutConversation } from "./conversation-graph";
import { SPECIAL_LABELS } from "./folder-tree";
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
const ROW = 68;
const LANE = 18;
const GUTTER = 16;
const TOP = 10;
const NODE = 5.5;

/**
 * One colour per lane, in the order the lanes open. These are the theme's own
 * colours, so the graph follows light and dark with everything else. The first
 * lane is the accent: the conversation as it normally runs is the iris line,
 * and a branch is what is drawn in something else.
 */
const LANE_COLORS = ["var(--accent)", "var(--ok)", "var(--seal)", "var(--risk)", "var(--warn)"];

const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]!;
const laneX = (lane: number) => GUTTER + lane * LANE;
const rowY = (index: number) => TOP + index * ROW + ROW / 2;

function snippetOf(entry: ThreadEntry): string {
	if (entry.kind === "message") return entry.message.snippet;
	return entry.message.bodyText.replace(/\s+/g, " ").trim();
}

/**
 * The path from the message answered to the one answering it. In the same lane
 * it is a straight line. Into another lane it leaves the parent at once in one
 * smooth S, then runs straight down its own lane to the child, which is how a
 * branch reads in a source graph: it starts where it started, not where it
 * ends.
 */
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
	if (from.x === to.x) return `M ${from.x} ${from.y} V ${to.y}`;
	const bend = Math.min(ROW * 0.9, to.y - from.y);
	const mid = from.y + bend / 2;
	const turn = `M ${from.x} ${from.y} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${from.y + bend}`;
	return bend < to.y - from.y ? `${turn} V ${to.y}` : turn;
}

/**
 * The whole conversation as a graph: what came in, what went out, and what is
 * still a draft or waiting to go. A second answer to the same mail, or a mail
 * sent on to somebody else, leaves the line as a branch in a colour of its own.
 * Choosing a row puts it in the reading pane and changes nothing about the
 * messages themselves.
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
	const gutter = laneX(graph.lanes - 1) + GUTTER;
	const height = TOP * 2 + entries.length * ROW;

	return (
		<aside aria-label="Conversation" className="flex w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--paper)]">
			<h3 className="flex shrink-0 items-baseline justify-between px-4 pb-1 pt-4 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
				Conversation
				<span className="tabular normal-case tracking-normal">{entries.length}</span>
			</h3>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="relative" style={{ height }}>
					<svg aria-hidden width={gutter} height={height} className="absolute left-0 top-0 overflow-visible">
						{/*
							Each line is drawn twice, a wide stroke in the window's own colour
							under the coloured one, so where two lanes cross the front one
							reads as passing over instead of merging.
						*/}
						{graph.rows.map((row, index) => {
							if (row.parent === null) return null;
							const d = edgePath(
								{ x: laneX(graph.rows[row.parent]!.lane), y: rowY(row.parent) },
								{ x: laneX(row.lane), y: rowY(index) },
							);
							return (
								<g key={row.id} fill="none" strokeLinecap="round">
									<path d={d} strokeWidth={6} style={{ stroke: "var(--paper)" }} />
									<path d={d} strokeWidth={2.25} style={{ stroke: laneColor(row.lane) }} />
								</g>
							);
						})}
						{entries.map((entry, index) => {
							const row = graph.rows[index]!;
							const color = laneColor(row.lane);
							const mine = entry.kind === "outgoing" || entry.message.folderUse === "sent";
							const unsent = entry.kind === "outgoing" && entry.message.state !== "sent";
							const selected = entry.message.id === openId;
							const x = laneX(row.lane);
							const y = rowY(index);
							return (
								<g key={entry.message.id}>
									<circle
										cx={x}
										cy={y}
										r={11}
										style={{ fill: color }}
										className={`transition-opacity duration-[var(--duration-base)] ease-[var(--ease)] ${selected ? "opacity-20" : "opacity-0"}`}
									/>
									<circle cx={x} cy={y} r={NODE + 2.5} style={{ fill: "var(--paper)" }} />
									<circle
										cx={x}
										cy={y}
										r={mine ? NODE - 0.75 : NODE}
										strokeWidth={2.5}
										strokeDasharray={unsent ? "2.5 2.5" : undefined}
										style={{ stroke: color, fill: mine ? "var(--paper)" : color }}
									/>
								</g>
							);
						})}
					</svg>
					<ol>
						{entries.map((entry, index) => {
							const id = entry.message.id;
							const row = graph.rows[index]!;
							const selected = id === openId;
							const outgoing = entry.kind === "outgoing";
							const mine = outgoing || entry.message.folderUse === "sent";
							const name = mine
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
										style={{
											paddingLeft: gutter + 12,
											boxShadow: selected ? `inset 3px 0 0 ${laneColor(row.lane)}` : undefined,
										}}
										className={[
											"flex h-full w-full flex-col justify-center gap-0.5 pr-4 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
											"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]",
											selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
										].join(" ")}
									>
										<span className="flex items-center gap-2 text-[length:var(--text-dense)]">
											<span
												className={`truncate ${unread ? "font-[var(--weight-semibold)]" : "font-[var(--weight-medium)]"}`}
											>
												{name}
											</span>
											{unread ? (
												<span
													aria-label="Unread"
													className="size-1.5 shrink-0 rounded-[var(--radius-full)]"
													style={{ background: laneColor(row.lane) }}
												/>
											) : null}
											{hasAttachment ? (
												<Icon name="attachment" size={12} className="shrink-0 text-[var(--ink-muted)]" />
											) : null}
											<span className="tabular ml-auto shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												{formatWhen(when)}
											</span>
										</span>
										{mine ? (
											<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												To {participantsLine(entry.message.to)}
											</span>
										) : null}
										<span className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{entry.kind === "message" && entry.message.folderName ? (
												<span
													title={`In ${entry.message.folderName}`}
													className={`shrink-0 rounded-[var(--radius-sm)] px-1.5 text-[length:var(--text-micro)] ${
														entry.message.folderUse === "trash"
															? "bg-[var(--risk-soft)] text-[var(--risk)]"
															: "bg-[var(--sunken)] text-[var(--ink-muted)]"
													}`}
												>
													{entry.message.folderUse
														? SPECIAL_LABELS[entry.message.folderUse]
														: entry.message.folderName}
												</span>
											) : null}
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
