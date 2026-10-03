import { useCallback, useEffect, useState } from "react";
import type { AgentAction, AgentAuditView, AuditEvent } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { AutomationList } from "./AutomationList";
import { ConnectionPanel } from "./ConnectionPanel";
import { EntityChip } from "./EntityChip";
import { formatWhen, RESULT_TONES } from "./format";
import { RequestList } from "./RequestList";
import { ToolTile } from "./ToolTile";

type Tab = "requests" | "automations" | "log" | "connection";

/**
 * Connection is on this screen and not only in settings, which is where it
 * ended up for a while. Settings is a modal window somebody opens to change
 * how Juno behaves; connecting an agent is a job with steps, done once, with
 * the tool list and the pending requests beside it as the thing being
 * connected to.
 */
const TABS: { id: Tab; label: string; icon: IconName }[] = [
	{ id: "requests", label: "Requests", icon: "inbox" },
	{ id: "automations", label: "Automations", icon: "play" },
	{ id: "log", label: "Log", icon: "list" },
	{ id: "connection", label: "Connection", icon: "link" },
];

/**
 * Everything an agent did, asked for, or could ask for.
 *
 * The requests tab is the one that matters: it is where the confirmation gate
 * is answered, and without it an agent's side-effectful calls simply sit.
 */
export function AgentScreen() {
	const [tab, setTab] = useState<Tab>("requests");
	const [actions, setActions] = useState<AgentAction[] | null>(null);
	const [actionsError, setActionsError] = useState<string | null>(null);
	const [version, setVersion] = useState(0);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(() => setVersion((value) => value + 1), []);

	useEffect(() => {
		let cancelled = false;
		window.juno.agent.actions
			.list({ limit: 100 })
			.then((rows) => {
				if (cancelled) return;
				setActions(rows);
				setActionsError(null);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setActionsError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [version]);

	// A request can arrive while this screen is open, from an agent nobody is
	// watching, so the list is pushed rather than polled.
	useEffect(() => window.juno.agent.actions.onChange(() => refresh()), [refresh]);

	const pending = actions?.filter((action) => action.state === "pending").length ?? 0;
	const dismissNotice = useCallback(() => setNotice(null), []);

	return (
		<div className="h-full overflow-y-auto p-8">
			<div className="mx-auto w-full max-w-[var(--content-width)]">
				<div className="flex items-center gap-4">
					<span className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)] text-[var(--accent)]">
						<Icon name="agent" size={24} />
					</span>
					<div>
						<h1 className="text-[length:var(--text-h2)] font-[var(--weight-semibold)] leading-[var(--leading-tight)] tracking-[-0.02em]">
							Agent
						</h1>
						<p className="mt-1 max-w-[68ch] text-[var(--ink-muted)]">
							Juno exposes everything it can do to an agent on this machine. Reading happens freely; anything
							that changes a record or sends a mail waits here for you.
						</p>
					</div>
				</div>

				<div
					className="mt-6 flex items-center gap-px border-b border-[var(--line)]"
					role="tablist"
					aria-label="Agent"
				>
					{TABS.map((entry) => (
						<button
							key={entry.id}
							type="button"
							role="tab"
							aria-selected={tab === entry.id}
							onClick={() => setTab(entry.id)}
							className={`-mb-px flex h-[36px] items-center gap-2 border-b-2 px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								tab === entry.id
									? "border-[var(--accent)] text-[var(--accent)]"
									: "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
							}`}
						>
							<Icon name={entry.icon} size={14} />
							{entry.label}
							{entry.id === "requests" && pending > 0 ? (
								<span className="tabular rounded-[var(--radius-full)] bg-[var(--warn-soft)] px-1.5 text-[length:var(--text-micro)] text-[var(--warn)]">
									{pending}
								</span>
							) : null}
						</button>
					))}
				</div>

				<div className="mt-6">
					{tab === "requests" ? (
						<RequestList
							actions={actions}
							error={actionsError}
							onChanged={refresh}
							onNotice={setNotice}
						/>
					) : tab === "automations" ? (
						<AutomationList
							onNotice={setNotice}
							onChanged={refresh}
						/>
					) : tab === "log" ? (
						<AuditLog onNotice={setNotice} />
					) : (
						<ConnectionPanel onNotice={setNotice} />
					)}
				</div>
			</div>

			{notice ? (
				<Toast
					message={notice}
					onDismiss={dismissNotice}
				/>
			) : null}
		</div>
	);
}

const ACTOR_LABELS: Record<AuditEvent["actor"], string> = {
	user: "You",
	agent: "Agent",
	automation: "Automation",
};

/** Everything that changed a record, whoever changed it. */
function AuditLog({ onNotice }: { onNotice: (message: string) => void }) {
	const [rows, setRows] = useState<AuditEvent[] | null>(null);
	const [views, setViews] = useState<Map<string, AgentAuditView>>(new Map());
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.agent.audit
			.list({ limit: 200 })
			.then(async (value) => {
				if (cancelled) return;
				setRows(value);
				try {
					const described = await window.juno.agent.audit.describe(value.map((row) => row.id));
					if (!cancelled) setViews(new Map(described.map((view) => [view.eventId, view])));
				} catch {
					// A log without the names is still a log.
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the log.</p>
				<p
					data-selectable
					className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
				>
					{error}
				</p>
			</div>
		);
	}
	if (rows === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;
	if (rows.length === 0) {
		return (
			<p className="max-w-[68ch] text-[var(--ink-muted)]">
				Nothing yet. Every call that changes a record is logged here, with who made it and how it ended. The
				arguments are not kept; a digest of them is, so two identical calls can be told apart.
			</p>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[var(--content-width)] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
			{rows.map((row) => {
				const view = views.get(row.id) ?? null;
				return (
					<div
						key={row.id}
						className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 last:border-b-0 hover:bg-[var(--hover)]"
					>
						<ToolTile toolName={row.toolName} size="small" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
								{view?.title ?? row.summary}
							</p>
							{view?.entity ? (
								<div className="mt-1">
									<EntityChip entity={view.entity} compact onNotice={onNotice} />
								</div>
							) : null}
							{row.error ? (
								<p data-selectable className="mt-1 truncate text-[length:var(--text-sm)] text-[var(--risk)]">
									{row.error}
								</p>
							) : null}
						</div>
						<span className="w-[78px] shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{ACTOR_LABELS[row.actor]}
						</span>
						<span
							className={`w-[64px] shrink-0 text-right text-[length:var(--text-sm)] font-[var(--weight-medium)] ${RESULT_TONES[row.result]}`}
						>
							{RESULT_LABELS[row.result]}
						</span>
						<span className="tabular w-[92px] shrink-0 text-right text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{formatWhen(row.createdAt)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

const RESULT_LABELS: Record<AuditEvent["result"], string> = {
	ok: "Done",
	failed: "Failed",
	pending: "Waiting",
	rejected: "Rejected",
	expired: "Expired",
};
