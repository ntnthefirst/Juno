import { useEffect, useState, type ReactNode } from "react";
import type { AgentAction, AgentActionView } from "@shared/types";
import { Button } from "../../components/Button";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { useContextMenu } from "../../lib/use-context-menu";
import { EntityChip } from "./EntityChip";
import { viewSentMail } from "./entity-links";
import { ACTION_LABELS, ACTION_TONES, formatArgs, formatWhen, parseMailPreview, timeAgo, timeLeft } from "./format";
import { ToolTile } from "./ToolTile";
import { toolVisual, VERBS } from "./tool-visual";
import { useNow } from "./use-now";

type RequestListProps = {
	actions: AgentAction[] | null;
	error: string | null;
	onChanged: () => void;
	onNotice: (message: string) => void;
};

/** The words for every request on screen, fetched together and kept by id. */
function useViews(actions: AgentAction[] | null): Map<string, AgentActionView> {
	const [views, setViews] = useState<Map<string, AgentActionView>>(new Map());
	// Read again whenever the set of requests changes, since a record a request
	// names may have been renamed or deleted in the meantime. The key carries
	// each id and the moment it last changed, and the ids are read back from it.
	const key = actions?.map((action) => `${action.id}:${action.updatedAt}`).join(",") ?? "";
	useEffect(() => {
		if (key === "") return;
		const ids = key.split(",").map((part) => part.split(":")[0]!);
		let cancelled = false;
		window.juno.agent.actions
			.describe(ids)
			.then((list) => {
				if (!cancelled) setViews(new Map(list.map((view) => [view.actionId, view])));
			})
			.catch(() => {
				// Without the words a request still shows its summary and can be answered.
			});
		return () => {
			cancelled = true;
		};
	}, [key]);
	return views;
}

/**
 * What an agent asked for, and the two buttons that are the whole point of
 * the tab: nothing here has happened yet.
 */
export function RequestList({ actions, error, onChanged, onNotice }: RequestListProps) {
	const views = useViews(actions);
	const now = useNow();

	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the requests.</p>
				<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (actions === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	const pending = actions.filter((action) => action.state === "pending");
	const answered = actions.filter((action) => action.state !== "pending");

	return (
		<div className="w-full">
			<section>
				<div className="flex items-baseline gap-3 pb-3">
					<h2 className="text-h3">Waiting for you</h2>
					<span className="tabular rounded-[var(--radius-full)] bg-[var(--warn-soft)] px-2 text-sm text-[var(--warn)]">
						{pending.length}
					</span>
				</div>
				{pending.length === 0 ? (
					<div className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--line-strong)] p-6">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--ok-soft)] text-[var(--ok)]">
							<Icon name="check" size={20} />
						</span>
						<div>
							<p className="font-[var(--weight-medium)]">Nothing is waiting</p>
							<p className="mt-0.5 max-w-[60ch] text-dense text-[var(--ink-muted)]">
								When an agent asks for something that changes a record or sends a mail, it appears here as
								a card you can read, and nothing happens until you approve it.
							</p>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-4">
						{pending.map((action) => (
							<RequestCard
								key={action.id}
								action={action}
								view={views.get(action.id) ?? null}
								now={now}
								onChanged={onChanged}
								onNotice={onNotice}
							/>
						))}
					</div>
				)}
			</section>

			{answered.length > 0 ? (
				<section className="mt-10">
					<h2 className="pb-3 text-base font-[var(--weight-medium)] text-[var(--ink-muted)]">Answered</h2>
					<div className="flex flex-col gap-4">
						{answered.map((action) => (
							<AnsweredCard
								key={action.id}
								action={action}
								view={views.get(action.id) ?? null}
								onChanged={onChanged}
								onNotice={onNotice}
							/>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}

type CardProps = {
	action: AgentAction;
	view: AgentActionView | null;
	onChanged: () => void;
	onNotice: (message: string) => void;
};

type CardShellProps = {
	action: AgentAction;
	view: AgentActionView | null;
	tile: ReactNode;
	subline: ReactNode;
	trailing: ReactNode;
	menuItems: MenuItem[];
	onNotice: (message: string) => void;
};

/**
 * The shape a waiting and an answered request share, as the Request Card draws
 * it: a tile, what it is and when, what to do about it on the right, and under
 * that the records it names, with the full payload one click away.
 */
function CardShell({ action, view, tile, subline, trailing, menuItems, onNotice }: CardShellProps) {
	const menu = useContextMenu();
	const [technical, setTechnical] = useState(false);
	const short = view?.fields.filter((field) => !field.long) ?? [];
	const long = view?.fields.filter((field) => field.long) ?? [];
	const mail = action.preview ? parseMailPreview(action.preview) : null;
	const title = view?.title ?? action.summary;

	return (
		<article
			onContextMenu={menu.open}
			className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6"
		>
			<header className="flex items-center gap-4">
				{tile}
				<div className="min-w-0 flex-1">
					<h3 className="text-lg font-[var(--weight-medium)]">{title}</h3>
					<p className="text-dense text-[var(--ink-muted)]">{subline}</p>
				</div>
				<div className="flex shrink-0 items-center gap-3">{trailing}</div>
			</header>

			<div className="flex flex-col gap-4 pl-[60px]">
				<div className="flex flex-wrap items-center gap-4">
					{view?.entities.map((entity) => (
						<EntityChip key={`${entity.kind}:${entity.id}`} entity={entity} onNotice={onNotice} />
					))}
					<button
						type="button"
						aria-expanded={technical}
						onClick={() => setTechnical((value) => !value)}
						className="rounded-[var(--radius-sm)] text-dense text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					>
						Technical details
					</button>
				</div>

				{short.length > 0 ? (
					<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-dense">
						{short.map((field) => (
							<div key={field.label} className="contents">
								<dt className="text-[var(--ink-muted)]">{field.label}</dt>
								<dd data-selectable className="min-w-0 break-words">
									{field.value}
								</dd>
							</div>
						))}
					</dl>
				) : null}

				{long.map((field) => (
					<div key={field.label}>
						<p className="mb-1 text-sm text-[var(--ink-muted)]">{field.label}</p>
						<p
							data-selectable
							className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 text-dense"
						>
							{field.value}
						</p>
					</div>
				))}

				{action.preview ? (
					mail ? (
						<MailCard preview={mail} />
					) : (
						<pre
							data-selectable
							className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-sans text-dense"
						>
							{action.preview}
						</pre>
					)
				) : null}

				{technical ? (
					<div>
						<p className="text-sm text-[var(--ink-muted)]">
							Tool <span className="font-mono">{action.toolName}</span>, asked {formatWhen(action.createdAt)}
						</p>
						<pre
							data-selectable
							className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-mono text-sm"
						>
							{formatArgs(action.args)}
						</pre>
					</div>
				) : null}
			</div>

			{menu.at ? <ContextMenu at={menu.at} items={menuItems} onClose={menu.close} ariaLabel={title} /> : null}
		</article>
	);
}

/** A request that is waiting. Nothing has happened until Approve is pressed. */
function RequestCard({ action, view, now, onChanged, onNotice }: CardProps & { now: number | null }) {
	const [busy, setBusy] = useState(false);
	const verb = VERBS[toolVisual(action.toolName).verb];

	async function answer(approve: boolean) {
		if (busy) return;
		setBusy(true);
		try {
			if (approve) await window.juno.agent.actions.approve(action.id);
			else await window.juno.agent.actions.reject(action.id);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
			onChanged();
		} finally {
			setBusy(false);
		}
	}

	const items: MenuItem[] = [
		{ id: "approve", label: "Approve", icon: "check", disabled: busy, onSelect: () => void answer(true) },
		{ id: "reject", label: "Reject", icon: "close", disabled: busy, onSelect: () => void answer(false) },
	];

	return (
		<CardShell
			action={action}
			view={view}
			tile={<ToolTile toolName={action.toolName} />}
			subline={
				<>
					{verb.label}
					{now !== null ? ` · asked ${timeAgo(action.createdAt, now)} · ${timeLeft(action.expiresAt, now)}` : ""}
					{action.automationRunId ? " · a step in an automation" : ""}
				</>
			}
			trailing={
				<>
					<Button disabled={busy} onClick={() => void answer(false)}>
						Reject
					</Button>
					<Button variant="primary" disabled={busy} onClick={() => void answer(true)}>
						{busy ? "Working" : "Approve"}
					</Button>
				</>
			}
			menuItems={items}
			onNotice={onNotice}
		/>
	);
}

type MailCardProps = {
	preview: NonNullable<ReturnType<typeof parseMailPreview>>;
};

/** The message as it would arrive: who it is from and to, the subject, and the text. */
function MailCard({ preview }: MailCardProps) {
	const subject = preview.headers.find((header) => header.label === "Subject")?.value ?? "";
	const others = preview.headers.filter((header) => header.label !== "Subject");
	return (
		<div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--paper)]">
			<div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--sunken)] px-4 py-2">
				<Icon name="mail" size={14} className="shrink-0 text-[var(--ink-muted)]" />
				<p data-selectable className="min-w-0 truncate font-[var(--weight-semibold)]">
					{subject || "(no subject)"}
				</p>
			</div>
			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 border-b border-[var(--line)] px-4 py-2 text-sm">
				{others.map((header) => (
					<div key={header.label} className="contents">
						<dt className="text-[var(--ink-muted)]">{header.label}</dt>
						<dd data-selectable className="min-w-0 break-words">
							{header.value}
						</dd>
					</div>
				))}
			</dl>
			<p
				data-selectable
				className="max-h-[300px] overflow-auto whitespace-pre-wrap px-4 py-3 text-dense"
			>
				{preview.body || "(no text)"}
			</p>
		</div>
	);
}

/** What happened to a request, in a sentence, with the time it was answered. */
function answeredLine(action: AgentAction): string {
	const at = formatWhen(action.decidedAt ?? action.createdAt).slice(-5);
	switch (action.state) {
		case "closed":
			return `You sent it yourself at ${at} · the request closed on its own`;
		case "rejected":
			return `You rejected it at ${at}`;
		case "expired":
			return `Nobody answered it. It expired at ${at}`;
		case "failed":
			return `You approved it at ${at}, and it failed`;
		default:
			return `You approved it at ${at}`;
	}
}

const ANSWERED_TILES: Partial<Record<AgentAction["state"], { icon: "check" | "close" | "recent"; tone: string }>> = {
	rejected: { icon: "close", tone: "bg-[var(--sunken)] text-[var(--ink-muted)]" },
	expired: { icon: "recent", tone: "bg-[var(--sunken)] text-[var(--ink-muted)]" },
	failed: { icon: "close", tone: "bg-[var(--risk-soft)] text-[var(--risk)]" },
};

/** A request somebody has dealt with. It stays until it is cleared. */
function AnsweredCard({ action, view, onChanged, onNotice }: CardProps) {
	const [busy, setBusy] = useState(false);

	async function clear() {
		if (busy) return;
		setBusy(true);
		try {
			await window.juno.agent.actions.remove(action.id);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const items: MenuItem[] = [
		{ id: "clear", label: "Clear", icon: "remove", disabled: busy, onSelect: () => void clear() },
	];
	const tile = ANSWERED_TILES[action.state] ?? { icon: "check" as const, tone: "bg-[var(--ok-soft)] text-[var(--ok)]" };
	// A mail that went out, by the person's hand or on their approval, can be read
	// where it is now. Only while the record still exists.
	const sentMail =
		action.state === "closed" || action.state === "executed"
			? view?.entities.find((entity) => entity.kind === "mailDraft" && !entity.gone)
			: undefined;

	return (
		<CardShell
			action={action}
			view={view}
			tile={
				<span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] ${tile.tone}`}>
					<Icon name={tile.icon} size={22} />
				</span>
			}
			subline={
				<>
					{answeredLine(action)}
					{action.error ? <span className="text-[var(--risk)]">{` · ${action.error}`}</span> : null}
				</>
			}
			trailing={
				<>
					<span className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-micro ${ACTION_TONES[action.state]}`}>
						{ACTION_LABELS[action.state]}
					</span>
					{sentMail ? (
						<button
							type="button"
							onClick={() => void viewSentMail(sentMail).catch((cause: unknown) => onNotice(messageOf(cause)))}
							className="rounded-[var(--radius-sm)] text-base font-[var(--weight-medium)] text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						>
							View mail
						</button>
					) : null}
					<Button size="dense" disabled={busy} onClick={() => void clear()}>
						Clear
					</Button>
				</>
			}
			menuItems={items}
			onNotice={onNotice}
		/>
	);
}
