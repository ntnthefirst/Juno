import { useEffect, useMemo, useState } from "react";
import type { AgentAction, AgentActionView } from "@shared/types";
import { Button } from "../../components/Button";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { useContextMenu } from "../../lib/use-context-menu";
import { EntityChip } from "./EntityChip";
import {
	ACTION_LABELS,
	ACTION_TONES,
	dayHeading,
	formatArgs,
	formatWhen,
	parseMailPreview,
	timeAgo,
	timeLeft,
} from "./format";
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
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (actions === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	const pending = actions.filter((action) => action.state === "pending");
	const answered = actions.filter((action) => action.state !== "pending");

	// Answered requests grouped by the day they were answered, newest first.
	const days: { heading: string; rows: AgentAction[] }[] = [];
	if (now !== null) {
		for (const action of answered) {
			const heading = dayHeading(action.decidedAt ?? action.createdAt, now);
			const last = days[days.length - 1];
			if (last && last.heading === heading) last.rows.push(action);
			else days.push({ heading, rows: [action] });
		}
	}

	return (
		<div className="w-full">
			<section>
				<div className="flex items-baseline gap-3 pb-3">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)]">Waiting for you</h2>
					<span className="tabular rounded-[var(--radius-full)] bg-[var(--warn-soft)] px-2 text-[length:var(--text-sm)] text-[var(--warn)]">
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
							<p className="mt-0.5 max-w-[60ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
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

			{days.length > 0 ? (
				<section className="mt-10">
					<h2 className="pb-1 text-[length:var(--text-h3)] font-[var(--weight-semibold)]">Answered</h2>
					{days.map((day) => (
						<div key={day.heading} className="mt-4">
							<p className="px-2 pb-1 text-[length:var(--text-micro)] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
								{day.heading}
							</p>
							<div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
								{day.rows.map((action) => (
									<AnsweredRow
										key={action.id}
										action={action}
										view={views.get(action.id) ?? null}
										onChanged={onChanged}
										onNotice={onNotice}
									/>
								))}
							</div>
						</div>
					))}
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

/** A pending request floats above the page while it waits, so it earns a surface. */
function RequestCard({ action, view, now, onChanged, onNotice }: CardProps & { now: number | null }) {
	const [busy, setBusy] = useState(false);
	const menu = useContextMenu();
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

	const short = view?.fields.filter((field) => !field.long) ?? [];
	const long = view?.fields.filter((field) => field.long) ?? [];
	const mail = action.preview ? parseMailPreview(action.preview) : null;

	return (
		<article
			onContextMenu={menu.open}
			className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]"
		>
			<header className="flex items-start gap-4 p-4">
				<ToolTile toolName={action.toolName} />
				<div className="min-w-0 flex-1">
					<h3 className="text-[length:var(--text-base)] font-[var(--weight-semibold)] leading-[var(--leading-tight)]">
						{view?.title ?? action.summary}
					</h3>
					<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{verb.label}
						{now !== null ? (
							<>
								{" · asked "}
								{timeAgo(action.createdAt, now)}
								{" · "}
								{timeLeft(action.expiresAt, now)}
							</>
						) : null}
						{action.automationRunId ? " · a step in an automation" : ""}
					</p>
				</div>
				<div className="flex shrink-0 gap-2">
					<Button disabled={busy} onClick={() => void answer(false)}>
						Reject
					</Button>
					<Button variant="primary" disabled={busy} onClick={() => void answer(true)}>
						{busy ? "Working" : "Approve"}
					</Button>
				</div>
			</header>

			<div className="flex flex-col gap-4 px-4 pb-4 pl-[72px]">
				{view && view.entities.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{view.entities.map((entity) => (
							<EntityChip key={`${entity.kind}:${entity.id}`} entity={entity} onNotice={onNotice} />
						))}
					</div>
				) : null}

				{short.length > 0 ? (
					<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[length:var(--text-dense)]">
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
						<p className="mb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{field.label}</p>
						<p
							data-selectable
							className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 text-[length:var(--text-dense)] leading-[var(--leading-relaxed)]"
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
							className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-sans text-[length:var(--text-dense)] leading-[var(--leading-relaxed)]"
						>
							{action.preview}
						</pre>
					)
				) : null}

				<details>
					<summary className="cursor-default text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Technical details
					</summary>
					<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Tool <span className="font-mono">{action.toolName}</span>, asked {formatWhen(action.createdAt)}
					</p>
					<pre
						data-selectable
						className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-mono text-[length:var(--text-sm)]"
					>
						{formatArgs(action.args)}
					</pre>
				</details>
			</div>

			{menu.at ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={view?.title ?? action.summary} />
			) : null}
		</article>
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
			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 border-b border-[var(--line)] px-4 py-2 text-[length:var(--text-sm)]">
				{others.map((header) => (
					<div key={header.label} className="contents">
						<dt className="text-[var(--ink-muted)]">{header.label === "Attached" ? "Attached" : header.label}</dt>
						<dd data-selectable className="min-w-0 break-words">
							{header.value}
						</dd>
					</div>
				))}
			</dl>
			<p
				data-selectable
				className="max-h-[300px] overflow-auto whitespace-pre-wrap px-4 py-3 text-[length:var(--text-dense)] leading-[var(--leading-relaxed)]"
			>
				{preview.body || "(no text)"}
			</p>
		</div>
	);
}

function AnsweredRow({ action, view, onChanged, onNotice }: CardProps) {
	const [busy, setBusy] = useState(false);
	const menu = useContextMenu();

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
	const shown = useMemo(() => view?.entities.slice(0, 2) ?? [], [view]);

	return (
		<div
			onContextMenu={menu.open}
			className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 last:border-b-0 hover:bg-[var(--hover)]"
		>
			<ToolTile toolName={action.toolName} size="small" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
					{view?.title ?? action.summary}
				</p>
				{shown.length > 0 ? (
					<div className="mt-1 flex flex-wrap gap-1.5">
						{shown.map((entity) => (
							<EntityChip key={`${entity.kind}:${entity.id}`} entity={entity} compact onNotice={onNotice} />
						))}
					</div>
				) : null}
				{action.error ? (
					<p data-selectable className="mt-1 truncate text-[length:var(--text-sm)] text-[var(--risk)]">
						{action.error}
					</p>
				) : null}
			</div>
			<span
				className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${ACTION_TONES[action.state]}`}
			>
				{ACTION_LABELS[action.state]}
			</span>
			<span className="tabular w-[44px] shrink-0 text-right text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{formatWhen(action.decidedAt ?? action.createdAt).slice(-5)}
			</span>
			<Button size="dense" disabled={busy} onClick={() => void clear()}>
				Clear
			</Button>

			{menu.at ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={view?.title ?? action.summary} />
			) : null}
		</div>
	);
}
