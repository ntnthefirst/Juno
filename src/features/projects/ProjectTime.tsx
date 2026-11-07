import { useCallback, useEffect, useState } from "react";
import type { RunningTimer, TimeEntry, TimeTotals } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";
import { MenuButton } from "../../components/Menu";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { formatClock, formatDuration, shortDay } from "./time-format";

type ProjectTimeProps = {
	projectId: string;
	/** Bumped by the page when something it did changes the entries, such as a form page saving one. */
	version: number;
	onAddEntry: () => void;
	onEditEntry: (entry: TimeEntry) => void;
	/** The figures changed here, so the Details column on the first tab has to read again. */
	onChanged: () => void;
};

type Loaded = { entries: TimeEntry[]; totals: TimeTotals; running: RunningTimer | null };
type Load = { status: "loading" } | { status: "ready"; data: Loaded } | { status: "error"; message: string };

type StatProps = { icon: IconName; label: string; value: string };

function Stat({ icon, label, value }: StatProps) {
	return (
		<div className="min-w-0 flex-1 rounded-[var(--radius-lg)] border border-[var(--line)] px-5 py-4">
			<p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
				<Icon name={icon} size={14} />
				{label}
			</p>
			<p className="tabular mt-2 text-h3">{value}</p>
		</div>
	);
}

/**
 * The time on a project: three figures, then the entries newest first. The
 * timer is one for the whole app, so starting one here while another runs on a
 * different project is refused by the service and the message says which.
 */
export function ProjectTime({ projectId, version, onAddEntry, onEditEntry, onChanged }: ProjectTimeProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [local, setLocal] = useState(0);
	const [now, setNow] = useState(() => Date.now());
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			window.juno.time.list(projectId),
			window.juno.time.total(projectId),
			window.juno.time.running(),
		])
			.then(([entries, totals, running]) => {
				if (!cancelled) setLoad({ status: "ready", data: { entries, totals, running } });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, version, local]);

	// An agent or the title bar can start or stop it, so the list follows the main process.
	useEffect(() => window.juno.time.onRunningChange(() => setLocal((value) => value + 1)), []);

	const running = load.status === "ready" ? load.data.running : null;
	const here = running !== null && running.entry.projectId === projectId;

	useEffect(() => {
		if (!here) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [here]);

	const changed = useCallback(() => {
		setLocal((value) => value + 1);
		onChanged();
	}, [onChanged]);

	async function toggle() {
		try {
			if (here) await window.juno.time.stop();
			else await window.juno.time.start(projectId);
			changed();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function remove(entry: TimeEntry) {
		try {
			await window.juno.time.remove(entry.id);
			changed();
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	if (load.status === "loading") return <p className="text-sm text-[var(--ink-muted)]">Loading.</p>;
	if (load.status === "error") {
		return (
			<p data-selectable className="text-sm text-[var(--risk)]">
				{load.message}
			</p>
		);
	}

	const { entries, totals } = load.data;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex gap-3">
				<Stat icon="recent" label="Logged" value={formatDuration(totals.loggedMinutes)} />
				<Stat
					icon="flag"
					label="Estimated"
					value={totals.estimatedMinutes === null ? "Not set" : formatDuration(totals.estimatedMinutes)}
				/>
				<Stat icon="list" label="Entries" value={String(totals.entryCount)} />
			</div>

			<section className="min-h-[320px] rounded-[var(--radius-lg)] border border-[var(--line)] p-5">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-baseline gap-3">
						<h2 className="text-base font-[var(--weight-medium)]">Time entries</h2>
						<span className="text-sm text-[var(--ink-muted)]">Newest first</span>
					</div>
					<div className="flex items-center gap-2">
						<Button size="dense" onClick={onAddEntry}>
							<Icon name="add" />
							Add entry
						</Button>
						<Button variant="primary" onClick={() => void toggle()}>
							{here ? "Stop timer" : "Start timer"}
						</Button>
					</div>
				</div>

				{entries.length === 0 ? (
					<p className="mt-3 text-sm text-[var(--ink-muted)]">
						No time logged yet. Start the timer, or add what you already spent.
					</p>
				) : (
					<ul className="mt-3 flex flex-col">
						{entries.map((entry) => {
							const live = entry.endedAt === null;
							return (
								<li
									key={entry.id}
									className="group flex items-center gap-4 border-b border-[var(--line)] px-1"
									style={{ height: "var(--row-height-roomy)" }}
								>
									<span className="tabular w-14 flex-none text-sm text-[var(--ink-muted)]">
										{shortDay(entry.startedAt)}
									</span>
									<span className="min-w-0 flex-1 truncate text-base">
										{entry.note ?? "Time entry"}
									</span>
									<span
										className={`tabular flex-none text-base ${live ? "text-[var(--accent)]" : ""}`}
									>
										{live
											? formatClock((now - Date.parse(entry.startedAt)) / 1000)
											: formatDuration(entry.durationMinutes ?? 0)}
									</span>
									<MenuButton
										ariaLabel={`Actions for the entry on ${shortDay(entry.startedAt)}`}
										items={[
											{
												id: "edit",
												label: "Edit",
												icon: "edit",
												onSelect: () => onEditEntry(entry),
											},
											{
												id: "remove",
												label: live ? "Discard the timer" : "Delete",
												icon: "remove",
												danger: true,
												separatorBefore: true,
												onSelect: () => void remove(entry),
											},
										]}
									/>
								</li>
							);
						})}
					</ul>
				)}
			</section>

			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</div>
	);
}
