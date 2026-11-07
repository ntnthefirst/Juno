import { useEffect, useState } from "react";
import type { RunningTimer } from "@shared/types";
import { Icon } from "../components/Icon";
import { Tooltip } from "../components/Tooltip";
import { requestOpen } from "../lib/open-entity";
import { formatClock } from "../features/projects/time-format";

/**
 * The one running timer, in the title bar for as long as it runs, from any
 * screen. It reads the main process rather than the screen that started it,
 * so a timer an agent started shows up too and stopping it here is the same
 * call the Time tab makes. Nothing is drawn while no timer runs.
 */
export function TimerPill() {
	const [running, setRunning] = useState<RunningTimer | null>(null);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		let cancelled = false;
		void window.juno.time
			.running()
			.then((value) => {
				if (!cancelled) setRunning(value);
			})
			.catch(() => undefined);
		const off = window.juno.time.onRunningChange(setRunning);
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	// A second is the smallest thing the clock shows, so it ticks once a second
	// and only while there is something to tick.
	useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running]);

	if (!running) return null;

	const seconds = (now - Date.parse(running.entry.startedAt)) / 1000;
	const name = running.projectName;

	return (
		<div className="no-drag animate-fade mr-1 flex h-7 items-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
			<Tooltip label={`Open ${name}`} side="bottom" className="flex min-w-0">
				<button
					type="button"
					onClick={() => requestOpen({ kind: "project", id: running.entry.projectId, name })}
					aria-label={`Timer running on ${name}. Open the project.`}
					className="flex h-7 min-w-0 items-center gap-2 rounded-l-[var(--radius-md)] pr-1 pl-2 text-dense font-[var(--weight-medium)] hover:bg-[var(--hover)]"
				>
					<span aria-hidden className="h-1.5 w-1.5 flex-none rounded-[var(--radius-full)] bg-[var(--accent)]" />
					<span className="tabular flex-none">{formatClock(seconds)}</span>
					<span className="max-w-[120px] truncate text-[var(--ink-muted)]">{name}</span>
				</button>
			</Tooltip>
			<Tooltip label="Stop timer" side="bottom" className="flex">
				<button
					type="button"
					aria-label="Stop timer"
					onClick={() => void window.juno.time.stop().catch(() => undefined)}
					className="flex h-7 w-7 items-center justify-center rounded-r-[var(--radius-md)] hover:bg-[var(--hover)]"
				>
					<Icon name="stop" size={14} />
				</button>
			</Tooltip>
		</div>
	);
}
