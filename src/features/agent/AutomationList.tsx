import { useCallback, useEffect, useState } from "react";
import type { Automation, AutomationRun } from "@shared/types";
import { AddButton } from "../../components/AddButton";
import { Button } from "../../components/Button";
import { ContextMenu, MenuButton, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { useContextMenu } from "../../lib/use-context-menu";
import { AutomationForm } from "./AutomationForm";
import { describeTrigger, formatWhen, RUN_LABELS, RUN_TONES } from "./format";

type AutomationListProps = {
	onNotice: (message: string) => void;
	/** A run may have parked a step, which belongs on the requests tab. */
	onChanged: () => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: Automation[] }
	| { status: "error"; message: string };

export function AutomationList({ onNotice, onChanged }: AutomationListProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [runs, setRuns] = useState<AutomationRun[]>([]);
	const [form, setForm] = useState<{ automation: Automation | null } | null>(null);
	const [version, setVersion] = useState(0);
	const [busyId, setBusyId] = useState<string | null>(null);

	const refresh = useCallback(() => setVersion((value) => value + 1), []);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.automations.list(), window.juno.automations.runs(undefined, 30)])
			.then(([rows, runRows]) => {
				if (cancelled) return;
				setLoad({ status: "ready", rows });
				setRuns(runRows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [version]);

	useEffect(() => window.juno.automations.onRunChange(() => refresh()), [refresh]);

	async function act(id: string, work: () => Promise<unknown>, done?: string) {
		if (busyId) return;
		setBusyId(id);
		try {
			await work();
			if (done) onNotice(done);
			refresh();
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusyId(null);
		}
	}

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the automations.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}
	if (load.status === "loading") return <p className="text-[var(--ink-muted)]">Loading.</p>;

	if (form) {
		return (
			<AutomationForm
				automation={form.automation}
				onClose={() => setForm(null)}
				onSaved={() => {
					setForm(null);
					refresh();
				}}
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[var(--content-width)]">
			<div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-2">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Automations</h2>
				<AddButton label="New automation" onClick={() => setForm({ automation: null })} />
			</div>

			{load.rows.length === 0 ? (
				<p className="mt-4 max-w-[68ch] text-[var(--ink-muted)]">
					No automations yet. An automation is a list of tool calls Juno replays, by hand or on a
					schedule. A step that needs your approval still needs it, so one cannot be used to send
					mail while you are away.
				</p>
			) : (
				<div className="mt-4">
					{load.rows.map((automation) => (
						<AutomationRow
							key={automation.id}
							automation={automation}
							busyId={busyId}
							onEdit={(entry) => setForm({ automation: entry })}
							act={act}
						/>
					))}
				</div>
			)}

			{runs.length > 0 ? (
				<section className="mt-10">
					<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
						Recent runs
					</h2>
					<div className="mt-4">
						{runs.map((run) => (
							<details key={run.id} className="border-b border-[var(--line)] px-2 py-2">
								<summary className="flex cursor-default items-center gap-3">
									<span
										className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${RUN_TONES[run.status]}`}
									>
										{RUN_LABELS[run.status]}
									</span>
									<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
										{run.automationName}
									</span>
									<span className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{formatWhen(run.startedAt)}
									</span>
								</summary>
								<div className="mt-2 pl-2">
									{run.log.map((entry, index) => (
										<p key={index} className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											<span className="tabular">{entry.step + 1}.</span>{" "}
											<span className="font-mono">{entry.tool}</span>
											{` ${entry.outcome}`}
											{entry.detail ? `: ${entry.detail}` : ""}
										</p>
									))}
									{run.error ? (
										<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">
											{run.error}
										</p>
									) : null}
									{run.status === "waiting" ? (
										<Button
											size="dense"
											disabled={busyId !== null}
											onClick={() =>
												void act(run.id, () => window.juno.automations.cancelRun(run.id), "Run cancelled.")
											}
										>
											Cancel this run
										</Button>
									) : null}
								</div>
							</details>
						))}
					</div>
				</section>
			) : null}

		</div>
	);
}

type AutomationRowProps = {
	automation: Automation;
	/** Non-null while any row's action is in flight, this row's included. */
	busyId: string | null;
	onEdit: (automation: Automation) => void;
	act: (id: string, work: () => Promise<unknown>, done?: string) => Promise<void>;
};

/**
 * One act is a button and the rest are a menu, the same shape as a reminder
 * row: running it again is what happens on nearly all of them, and turning it
 * off, editing it and deleting it are occasional. The same four sit on the
 * right-click menu, so the mouse has both routes to any of them.
 */
function AutomationRow({ automation, busyId, onEdit, act }: AutomationRowProps) {
	const menu = useContextMenu();
	const busy = busyId !== null;

	const items: MenuItem[] = [
		{
			id: "run",
			label: "Run now",
			icon: "sync",
			disabled: busy,
			onSelect: () => void act(automation.id, () => window.juno.automations.run(automation.id)),
		},
		{
			id: "toggle",
			label: automation.enabled ? "Turn off" : "Turn on",
			icon: automation.enabled ? "close" : "check",
			disabled: busy,
			onSelect: () =>
				void act(automation.id, () =>
					window.juno.automations.update(automation.id, { enabled: !automation.enabled }),
				),
		},
		{
			id: "edit",
			label: "Edit",
			icon: "edit",
			disabled: busy,
			onSelect: () => onEdit(automation),
		},
		{
			id: "delete",
			label: "Delete",
			icon: "remove",
			danger: true,
			separatorBefore: true,
			disabled: busy,
			onSelect: () =>
				void act(
					automation.id,
					() => window.juno.automations.remove(automation.id),
					`${automation.name} deleted.`,
				),
		},
	];

	return (
		<div onContextMenu={menu.open} className="border-b border-[var(--line)] px-2 py-2.5 hover:bg-[var(--hover)]">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
						{automation.name}
						{automation.enabled ? null : (
							<span className="ml-2 font-[var(--weight-normal)] text-[var(--ink-muted)]">off</span>
						)}
					</p>
					<p className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{describeTrigger(automation.trigger)}
						{` · ${automation.steps.length} step${automation.steps.length === 1 ? "" : "s"}`}
						{automation.lastRunAt ? ` · last run ${formatWhen(automation.lastRunAt)}` : ""}
					</p>
				</div>
				{automation.lastStatus ? (
					<span
						className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${RUN_TONES[automation.lastStatus]}`}
					>
						{RUN_LABELS[automation.lastStatus]}
					</span>
				) : null}
				<div className="flex shrink-0 items-center gap-1">
					<Button
						size="dense"
						disabled={busy}
						onClick={() => void act(automation.id, () => window.juno.automations.run(automation.id))}
					>
						Run now
					</Button>
					<MenuButton items={items} ariaLabel={`More for ${automation.name}`} disabled={busy} />
				</div>
			</div>

			{menu.at ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={automation.name} />
			) : null}
		</div>
	);
}
