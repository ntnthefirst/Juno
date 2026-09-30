import { useEffect, useRef } from "react";
import type { ProjectRun } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";

type RunConsoleProps = {
	run: ProjectRun;
	onStop: () => void;
	onClear: () => void;
};

const STATE_WORDS: Record<ProjectRun["state"], string> = {
	running: "Running",
	exited: "Stopped",
	failed: "Failed",
};

const STATE_CLASSES: Record<ProjectRun["state"], string> = {
	running: "text-[var(--ok)]",
	exited: "text-[var(--ink-muted)]",
	failed: "text-[var(--risk)]",
};

/**
 * What a running command is printing.
 *
 * Monospace, because it is raw output and every column in it is meant to line
 * up. It follows the tail while the reader is already at the bottom and stops
 * following the moment they scroll up, which is the difference between a log
 * you can read and one that yanks itself away mid-sentence.
 */
export function RunConsole({ run, onStop, onClear }: RunConsoleProps) {
	const box = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);

	useEffect(() => {
		const node = box.current;
		if (node && pinned.current) node.scrollTop = node.scrollHeight;
	}, [run.output]);

	return (
		<section className="rounded-[var(--radius-md)] border border-[var(--line)]">
			<header className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2">
				<span className={`flex-none ${STATE_CLASSES[run.state]}`}>
					<Icon name={run.state === "running" ? "play" : run.state === "failed" ? "warning" : "stop"} />
				</span>
				<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
					<span className="font-[var(--weight-medium)]">{run.label}</span>
					<span className="ml-2 text-[var(--ink-muted)]">{run.command}</span>
				</span>
				<span className={`tabular flex-none text-[length:var(--text-micro)] ${STATE_CLASSES[run.state]}`}>
					{STATE_WORDS[run.state]}
					{run.exitCode !== null && run.state !== "running" ? ` (${run.exitCode})` : ""}
				</span>
				{run.state === "running" ? (
					<Button size="dense" onClick={onStop}>
						<Icon name="stop" />
						Stop
					</Button>
				) : (
					<Button size="dense" onClick={onClear}>
						Clear
					</Button>
				)}
			</header>

			{run.error ? (
				<p data-selectable className="border-b border-[var(--line)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--risk)]">
					{run.error}
				</p>
			) : null}

			<div
				ref={box}
				onScroll={(event) => {
					const node = event.currentTarget;
					// Within a line of the bottom counts as at the bottom: a fractional
					// scroll height would otherwise unpin the view on its own.
					pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
				}}
				className="max-h-[280px] overflow-y-auto bg-[var(--sunken)] px-3 py-2"
			>
				<pre
					data-selectable
					className="whitespace-pre-wrap break-words font-mono text-[length:var(--text-micro)] leading-[var(--leading-normal)] text-[var(--ink-muted)]"
				>
					{run.output.length > 0 ? run.output.join("\n") : "No output yet."}
				</pre>
			</div>

			<p className="tabular border-t border-[var(--line)] px-3 py-1.5 text-[length:var(--text-micro)] text-[var(--ink-faint)]">
				{run.workingDir}
			</p>
		</section>
	);
}
