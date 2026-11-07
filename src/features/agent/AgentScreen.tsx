import { useCallback, useEffect, useState } from "react";
import type { AgentAction, AgentAuditView, AuditEvent } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { Tabs } from "../../components/Tabs";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { AutomationList } from "./AutomationList";
import { EntityChip } from "./EntityChip";
import { formatLogWhen, logOutcome, logWho } from "./format";
import { RequestList } from "./RequestList";

type Tab = "requests" | "log" | "automations";

/**
 * Requests and Log are the two the design draws. Automations is the third,
 * beside them (decision 58), and connecting a client lives in Settings > MCP
 * with the rest of how Juno behaves toward an agent.
 */
const TABS: { id: Tab; label: string; icon: IconName }[] = [
	{ id: "requests", label: "Requests", icon: "inbox" },
	{ id: "log", label: "Log", icon: "list" },
	{ id: "automations", label: "Automations", icon: "play" },
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
			<div className="w-full">
				<div className="flex items-center gap-6">
					<span className="flex size-[72px] shrink-0 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--accent-soft)] text-[var(--accent)]">
						<Icon name="agent" size={32} />
					</span>
					<div>
						<h1 className="text-h1">Agent</h1>
						<p className="mt-1.5 max-w-[880px] text-lg text-[var(--ink-muted)]">
							Juno exposes everything it can do to an agent on this machine. Reading happens freely; anything
							that changes a record or sends a mail waits here for you.
						</p>
					</div>
				</div>

				<div className="mt-6">
					<Tabs
						label="Agent"
						tabs={TABS.map((entry) => ({
							...entry,
							count: entry.id === "requests" && pending > 0 ? pending : null,
						}))}
						value={tab}
						onChange={setTab}
					/>
				</div>

				<div className="mt-6">
					{tab === "requests" ? (
						<RequestList
							actions={actions}
							error={actionsError}
							onChanged={refresh}
							onNotice={setNotice}
						/>
					) : tab === "log" ? (
						<AuditLog onNotice={setNotice} />
					) : (
						<AutomationList onNotice={setNotice} onChanged={refresh} />
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
				<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (rows === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	return (
		<div>
			<p className="text-dense text-[var(--ink-muted)]">
				Everything the agent did, and everything you decided. Entries are kept for six months.
			</p>
			{rows.length === 0 ? (
				<p className="mt-6 max-w-[68ch] text-[var(--ink-muted)]">
					Nothing yet. Every call an agent makes is logged here, with who made it and how it ended. A read says only that it happened, never what it saw.
				</p>
			) : (
				<table className="mt-6 w-full border-collapse text-left">
					<thead>
						<tr className="border-b border-[var(--line)] text-dense text-[var(--ink-muted)]">
							<th scope="col" className="w-[190px] py-3 pr-4 font-normal">When</th>
							<th scope="col" className="py-3 pr-4 font-normal">Tool</th>
							<th scope="col" className="w-[260px] py-3 pr-4 font-normal">Outcome</th>
							<th scope="col" className="w-[120px] py-3 font-normal">Who</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const view = views.get(row.id) ?? null;
							const outcome = logOutcome(row);
							return (
								<tr key={row.id} className="h-[52px] border-b border-[var(--line)] align-middle hover:bg-[var(--hover)]">
									<td className="tabular py-2 pr-4 text-dense text-[var(--ink-muted)]">{formatLogWhen(row.createdAt)}</td>
									<td className="py-2 pr-4">
										<span className={`font-mono text-sm ${row.result === "read" ? "text-[var(--ink-muted)]" : ""}`}>{row.toolName}</span>
										{view?.entity ? (
											<div className="mt-1">
												<EntityChip entity={view.entity} compact onNotice={onNotice} />
											</div>
										) : null}
										{row.error ? (
											<p data-selectable className="mt-1 truncate text-sm text-[var(--risk)]">
												{row.error}
											</p>
										) : null}
									</td>
									<td className="py-2 pr-4">
										<span
											className={`inline-block rounded-[var(--radius-sm)] px-2 py-0.5 text-micro ${outcome.tone}`}
										>
											{outcome.label}
										</span>
									</td>
									<td className="py-2 text-dense">{logWho(row)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
		</div>
	);
}
