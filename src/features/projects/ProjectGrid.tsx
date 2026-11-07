import type { ProjectSummary, ProjectsView } from "@shared/types";
import { Icon } from "../../components/Icon";
import { contextMenuFor } from "../../lib/native-menu";
import { formatCents, formatDate, LINK_ICONS, LINK_LABELS } from "./format";
import { ProjectCover } from "./ProjectCover";
import { StatusBadge } from "../../components/StatusBadge";

type ProjectGridProps = {
	rows: ProjectSummary[];
	size: ProjectsView["size"];
	previews: boolean;
	onOpen: (project: ProjectSummary) => void;
	onRemove: (project: ProjectSummary) => void;
	/** The main process could not do what the menu asked. */
	onFailed: (message: string) => void;
};

/**
 * Tile widths, as a minimum for an auto-fill grid rather than a column count.
 * A fixed count leaves a card stretched across half the screen on a wide
 * window, and four cards crushed to nothing on a narrow one.
 */
const MINIMUM: Record<ProjectsView["size"], string> = {
	small: "180px",
	medium: "240px",
	large: "320px",
};

/** Covers keep 16:10, which is the shape of a screenshot of almost anything. */
const COVER_HEIGHT: Record<ProjectsView["size"], string> = {
	small: "h-[112px]",
	medium: "h-[150px]",
	large: "h-[200px]",
};

export function ProjectGrid({
	rows,
	size,
	previews,
	onOpen,
	onRemove,
	onFailed,
}: ProjectGridProps) {
	return (
		<>
			<ul
				className="grid gap-4"
				style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${MINIMUM[size]}, 1fr))` }}
			>
				{rows.map((row) => (
					<li key={row.id}>
						<button
							type="button"
							onClick={() => onOpen(row)}
							onContextMenu={contextMenuFor({ kind: "project", id: row.id }, { open: () => onOpen(row), delete: () => onRemove(row), failed: onFailed })}
							className="group flex w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:border-[var(--line-strong)] hover:bg-[var(--hover)]"
						>
							{previews ? (
								<ProjectCover
									assetId={row.coverAssetId}
									name={row.name}
									className={`w-full border-b border-[var(--line)] ${COVER_HEIGHT[size]}`}
								/>
							) : null}

							<div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
								<div className="flex min-w-0 items-start gap-2">
									<span className="min-w-0 flex-1 truncate font-[var(--weight-medium)]">
										{row.name}
									</span>
									{row.status ? <StatusBadge label={row.status.label} tone={row.status.tone} /> : null}
								</div>

								<span className="truncate text-sm text-[var(--ink-muted)]">
									{row.clientName ?? "Your own work"}
								</span>

								<div className="mt-1 flex items-center gap-3 text-[var(--ink-faint)]">
									{row.linkKinds.map((kind) => (
										// A row of silent glyphs otherwise. The title is what a person
										// hovering gets, and the alternative is a card full of words.
										<span key={kind} title={LINK_LABELS[kind]}>
											<Icon name={LINK_ICONS[kind]} size={14} />
										</span>
									))}
									{row.assetCount > 0 ? (
										<span className="tabular flex items-center gap-1 text-micro">
											<Icon name="image" size={14} />
											{row.assetCount}
										</span>
									) : null}
									{row.commandCount > 0 ? <Icon name="terminal" size={14} /> : null}

									<span className="tabular ml-auto whitespace-nowrap text-micro">
										{row.dueOn ? formatDate(row.dueOn) : formatCents(row.agreedValueCents)}
									</span>
								</div>
							</div>
						</button>
					</li>
				))}
			</ul>

		</>
	);
}
