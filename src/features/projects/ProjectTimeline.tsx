import { useEffect, useMemo, useState } from "react";
import type { ProjectTimelineEntry, ProjectTimelineKind } from "@shared/types";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { shortDay } from "./time-format";

type ProjectTimelineProps = {
	projectId: string;
	/** Bumped by the page when something it did adds a line, such as a time entry. */
	version: number;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; entries: ProjectTimelineEntry[] }
	| { status: "error"; message: string };

const KINDS: { kind: ProjectTimelineKind; label: string; dot: string }[] = [
	{ kind: "status", label: "Status changes", dot: "bg-[var(--seal)]" },
	{ kind: "mail", label: "Mail linked", dot: "bg-[var(--ink-faint)]" },
	{ kind: "quote", label: "Quote sent for signature", dot: "bg-[var(--accent)]" },
	{ kind: "time", label: "Time entries", dot: "bg-[var(--accent)]" },
	{ kind: "contract", label: "Contract signed", dot: "bg-[var(--ok)]" },
	{ kind: "created", label: "Project created", dot: "bg-[var(--seal)]" },
	{ kind: "folder", label: "Folder connected", dot: "bg-[var(--ink-faint)]" },
];

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

function monthOf(iso: string): { key: string; label: string } {
	const date = new Date(iso);
	const month = date.getMonth();
	return {
		key: `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}`,
		label: `${MONTHS[month]} ${date.getFullYear()}`,
	};
}

/**
 * A project's history as a vertical graph grouped by month, newest first. It
 * is read from the records themselves (services/project-timeline.ts), so a line
 * is there as soon as the thing it describes is.
 */
export function ProjectTimeline({ projectId, version }: ProjectTimelineProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [hidden, setHidden] = useState<ReadonlySet<ProjectTimelineKind>>(new Set());

	useEffect(() => {
		let cancelled = false;
		window.juno.projects
			.timeline({ projectId })
			.then((entries) => {
				if (!cancelled) setLoad({ status: "ready", entries });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, version]);

	const groups = useMemo(() => {
		if (load.status !== "ready") return [];
		const out: { key: string; label: string; entries: ProjectTimelineEntry[] }[] = [];
		for (const entry of load.entries) {
			if (hidden.has(entry.kind)) continue;
			const month = monthOf(entry.at);
			const last = out[out.length - 1];
			if (last && last.key === month.key) last.entries.push(entry);
			else out.push({ ...month, entries: [entry] });
		}
		return out;
	}, [load, hidden]);

	const items: MenuItem[] = KINDS.map((entry) => ({
		id: entry.kind,
		label: entry.label,
		...(hidden.has(entry.kind) ? {} : { icon: "check" as const }),
		onSelect: () =>
			setHidden((current) => {
				const next = new Set(current);
				if (next.has(entry.kind)) next.delete(entry.kind);
				else next.add(entry.kind);
				return next;
			}),
	}));

	function open(entry: ProjectTimelineEntry) {
		if (!entry.entityId) return;
		if (entry.kind === "mail") requestOpen({ kind: "thread", id: entry.entityId, messageId: null });
		else if (entry.kind === "quote" || entry.kind === "contract") {
			requestOpen({ kind: "document", id: entry.entityId, name: entry.title });
		}
	}

	return (
		<section className="px-1">
			<div className="mb-6 flex items-center justify-between gap-4">
				<h2 className="text-h3">Timeline</h2>
				<MenuButton ariaLabel="Filter the timeline" label="Filter" icon="filter" items={items} size="base" />
			</div>

			{load.status === "loading" ? (
				<p className="text-sm text-[var(--ink-muted)]">Loading.</p>
			) : load.status === "error" ? (
				<p data-selectable className="text-sm text-[var(--risk)]">
					{load.message}
				</p>
			) : groups.length === 0 ? (
				<p className="text-sm text-[var(--ink-muted)]">Nothing to show with this filter.</p>
			) : (
				<ol className="relative flex flex-col pl-6">
					<span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-[var(--line-strong)]" />
					{groups.map((group) => (
						<li key={group.key} className="relative pb-4">
							<span
								aria-hidden
								className="absolute top-[3px] -left-6 h-[11px] w-[11px] rounded-[var(--radius-full)] border-2 border-[var(--ink-muted)] bg-[var(--surface)]"
							/>
							<p className="text-overline uppercase text-[var(--ink-muted)]">{group.label}</p>
							<ol className="mt-3 flex flex-col gap-3">
								{group.entries.map((entry) => {
									const dot = KINDS.find((kind) => kind.kind === entry.kind)?.dot ?? "bg-[var(--ink-faint)]";
									const clickable = entry.entityId !== null && ["mail", "quote", "contract"].includes(entry.kind);
									return (
										<li key={entry.id} className="relative flex items-start justify-between gap-4">
											<span
												aria-hidden
												className={`absolute top-[7px] -left-[22px] h-[7px] w-[7px] rounded-[var(--radius-full)] ${dot}`}
											/>
											<div className="min-w-0">
												{clickable ? (
													<button
														type="button"
														onClick={() => open(entry)}
														className="text-left text-base hover:text-[var(--accent)]"
													>
														{entry.title}
													</button>
												) : (
													<p className="text-base">{entry.title}</p>
												)}
												{entry.detail ? <p className="text-sm text-[var(--ink-muted)]">{entry.detail}</p> : null}
											</div>
											<span className="tabular flex-none text-sm text-[var(--ink-muted)]">{shortDay(entry.at)}</span>
										</li>
									);
								})}
							</ol>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
