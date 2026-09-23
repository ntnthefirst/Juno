import { useCallback, useEffect, useState } from "react";
import type { AgentAction, AuditEvent } from "@shared/types";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { AutomationList } from "./AutomationList";
import { formatWhen, RESULT_TONES } from "./format";
import { RequestList } from "./RequestList";

type Tab = "requests" | "automations" | "log";

const TABS: { id: Tab; label: string }[] = [
	{ id: "requests", label: "Requests" },
	{ id: "automations", label: "Automations" },
	{ id: "log", label: "Log" },
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
				<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">Agent</h1>
				<p className="mt-2 max-w-[68ch] text-[var(--ink-muted)]">
					Juno exposes everything it can do to an agent on this machine. Reading happens freely; anything that
					changes a record waits here for you.
				</p>

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
						<AuditLog />
					) : null}
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
function AuditLog() {
	const [rows, setRows] = useState<AuditEvent[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.agent.audit
			.list({ limit: 200 })
			.then((value) => {
				if (!cancelled) setRows(value);
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
		<div className="mx-auto w-full max-w-[var(--content-width)]">
			{rows.map((row) => (
				<div
					key={row.id}
					className="flex items-center gap-3 border-b border-[var(--line)] px-2"
					style={{ height: "var(--row-height)" }}
				>
					<span className="tabular w-[92px] shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{formatWhen(row.createdAt)}
					</span>
					<span className="w-[78px] shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{row.actor}
					</span>
					<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">{row.summary}</span>
					<span className="w-[150px] shrink-0 truncate font-mono text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{row.toolName}
					</span>
					<span
						className={`w-[60px] shrink-0 text-right text-[length:var(--text-sm)] ${RESULT_TONES[row.result]}`}
						title={row.error ?? undefined}
					>
						{row.result}
					</span>
				</div>
			))}
		</div>
	);
}
