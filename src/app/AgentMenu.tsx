import { useCallback, useEffect, useState } from "react";
import type { AgentAction, AgentActionView, AgentAuditView, AuditEvent } from "@shared/types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { messageOf } from "../lib/errors";
import { logOutcome, timeAgo } from "../features/agent/format";
import { toolVisual } from "../features/agent/tool-visual";
import { TitleMenu, TitleMenuHeading } from "./TitleMenu";

type AgentMenuProps = {
	at: { x: number; y: number };
	onClose: () => void;
	/** The Agent screen, for the foot of the menu and for a request that needs reading in full. */
	onOpenScreen: () => void;
};

const WAITING = 5;
const LATELY = 3;

type Load = {
	waiting: AgentAction[];
	views: Map<string, AgentActionView>;
	lately: AuditEvent[];
	lateViews: Map<string, AgentAuditView>;
};

/** "10:42" for today, the day otherwise. */
function clock(iso: string, nowMs: number): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	if (new Date(nowMs).toDateString() !== at.toDateString()) return timeAgo(iso, nowMs);
	return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

async function fetchMenu(): Promise<Load> {
	const [waiting, lately] = await Promise.all([
		window.juno.agent.actions.list({ states: ["pending"], limit: WAITING }),
		window.juno.agent.audit.list({ actor: "agent", limit: LATELY }),
	]);
	const [views, lateViews] = await Promise.all([
		waiting.length > 0 ? window.juno.agent.actions.describe(waiting.map((row) => row.id)) : Promise.resolve([]),
		lately.length > 0 ? window.juno.agent.audit.describe(lately.map((row) => row.id)) : Promise.resolve([]),
	]);
	return {
		waiting,
		views: new Map(views.map((view) => [view.actionId, view])),
		lately,
		lateViews: new Map(lateViews.map((view) => [view.eventId, view])),
	};
}

/**
 * What the agent is waiting on and what it did last, under its button.
 *
 * A request that only changes a record here can be answered from the menu.
 * One that sends, signs, files or deletes says Review instead and opens the
 * Agent screen, where its whole payload is shown before the Approve button:
 * the service decides which is which (`review` on the request's words), and
 * approving still goes through the same gate either way.
 */
export function AgentMenu({ at, onClose, onOpenScreen }: AgentMenuProps) {
	const [load, setLoad] = useState<Load | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [now, setNow] = useState<number | null>(null);

	const read = useCallback(() => {
		fetchMenu()
			.then((next) => {
				setNow(Date.now());
				setLoad(next);
				setError(null);
			})
			.catch((cause: unknown) => setError(messageOf(cause)));
	}, []);

	useEffect(() => {
		read();
		return window.juno.agent.actions.onChange(read);
	}, [read]);

	async function answer(action: AgentAction, approve: boolean) {
		if (busy) return;
		setBusy(action.id);
		try {
			if (approve) await window.juno.agent.actions.approve(action.id);
			else await window.juno.agent.actions.reject(action.id);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
			read();
		}
	}

	function openScreen() {
		onClose();
		onOpenScreen();
	}

	return (
		<TitleMenu at={at} label="Agent" width={360} onClose={onClose} footer={{ label: "Open agent", onSelect: onOpenScreen }}>
			{error ? (
				<p data-selectable className="px-2.5 py-3 text-dense text-[var(--risk)]">
					{error}
				</p>
			) : null}
			{load === null ? (
				error ? null : <p className="px-2.5 py-3 text-dense text-[var(--ink-muted)]">Loading.</p>
			) : (
				<>
					<TitleMenuHeading>Waiting for you</TitleMenuHeading>
					{load.waiting.length === 0 ? (
						<p className="px-2.5 pb-2 text-dense text-[var(--ink-muted)]">Nothing is waiting for you.</p>
					) : (
						load.waiting.map((action) => {
							const view = load.views.get(action.id);
							const review = view?.review ?? true;
							return (
								<div key={action.id} className="rounded-[var(--radius-md)] px-2.5 pt-2 pb-2.5">
									<div className="flex gap-2.5">
										<Icon name={toolVisual(action.toolName).domain} size={16} className="mt-0.5 flex-none text-[var(--ink-muted)]" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-base text-[var(--ink)]">{action.summary}</p>
											<p className="truncate text-sm text-[var(--ink-muted)]">
												{[view?.title, now !== null ? timeAgo(action.createdAt, now) : null].filter(Boolean).join(" · ")}
											</p>
										</div>
									</div>
									<div className="mt-2 flex gap-1.5 pl-[26px]">
										{review ? (
											<Button size="dense" onClick={openScreen}>
												Review
											</Button>
										) : (
											<>
												<Button size="dense" disabled={busy !== null} onClick={() => void answer(action, false)}>
													Reject
												</Button>
												<Button variant="primary" size="dense" disabled={busy !== null} onClick={() => void answer(action, true)}>
													{busy === action.id ? "Working" : "Approve"}
												</Button>
											</>
										)}
									</div>
								</div>
							);
						})
					)}

					{load.lately.length > 0 ? (
						<>
							<TitleMenuHeading>Lately</TitleMenuHeading>
							{load.lately.map((event) => {
								const view = load.lateViews.get(event.id);
								const title = view ? (view.entity?.label ? `${view.title}: ${view.entity.label}` : view.title) : event.summary;
								return (
									<button
										key={event.id}
										type="button"
										onClick={openScreen}
										className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
									>
										<Icon name={toolVisual(event.toolName).domain} size={16} className="flex-none text-[var(--ink-muted)]" />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-base text-[var(--ink)]">{title}</span>
											<span className="tabular block truncate text-sm text-[var(--ink-muted)]">
												{[logOutcome(event).label, now !== null ? clock(event.createdAt, now) : null].filter(Boolean).join(" · ")}
											</span>
										</span>
									</button>
								);
							})}
						</>
					) : null}
				</>
			)}
		</TitleMenu>
	);
}
