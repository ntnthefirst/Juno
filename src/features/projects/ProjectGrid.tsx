import type { ProjectSummary, ProjectsView } from "@shared/types";
import { Checkbox } from "../../components/Checkbox";
import { Icon } from "../../components/Icon";
import { contextMenuFor } from "../../lib/native-menu";
import { formatCents, formatDate, LINK_ICONS, LINK_LABELS } from "./format";
import { ProjectCover } from "./ProjectCover";
import { StatusBadge } from "../../components/StatusBadge";

type ProjectGridProps = {
	rows: ProjectSummary[];
	size: ProjectsView["size"];
	previews: boolean;
	/** The cards ticked. Once any is, a click ticks rather than opens. */
	held: ReadonlySet<string>;
	/** `extend` (Shift) ticks the run from the last card ticked. */
	onPick: (id: string, extend: boolean) => void;
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

/**
 * A card has no avatar for the tick to stand in for, so the tick sits at its
 * top left: under the pointer, on keyboard focus, and on every card once
 * anything is ticked. It is outside the card's button, so ticking never opens.
 */
export function ProjectGrid({
	rows,
	size,
	previews,
	held,
	onPick,
	onOpen,
	onRemove,
	onFailed,
}: ProjectGridProps) {
	const hasSelection = held.size > 0;
	return (
		<>
			<ul
				className="grid gap-4"
				style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${MINIMUM[size]}, 1fr))` }}
			>
				{rows.map((row) => {
					const checked = held.has(row.id);
					return (
						<li key={row.id} className="group relative">
							<button
								type="button"
								aria-pressed={hasSelection ? checked : undefined}
								onClick={(event) => (hasSelection ? onPick(row.id, event.shiftKey) : onOpen(row))}
								onContextMenu={contextMenuFor({ kind: "project", id: row.id }, { open: () => onOpen(row), delete: () => onRemove(row), failed: onFailed })}
								className={[
									"flex w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
									checked
										? "border-[var(--accent)] bg-[var(--accent-soft)]"
										: "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:bg-[var(--hover)]",
								].join(" ")}
							>
								{previews ? (
									<ProjectCover
										assetId={row.coverAssetId}
										name={row.name}
										className={`w-full border-b border-[var(--line)] ${COVER_HEIGHT[size]}`}
									/>
								) : null}

								<div className={`flex min-w-0 flex-1 flex-col gap-1 p-3 ${previews ? "" : "pl-11"}`}>
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
							<label
								className={[
									"absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center",
									hasSelection
										? ""
										: "opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] group-hover:opacity-100 group-focus-within:opacity-100",
								].join(" ")}
							>
								<Checkbox
									checked={checked}
									onChange={(event) => onPick(row.id, (event.nativeEvent as MouseEvent).shiftKey)}
									aria-label={`Select ${row.name}`}
								/>
							</label>
						</li>
					);
				})}
			</ul>

		</>
	);
}
