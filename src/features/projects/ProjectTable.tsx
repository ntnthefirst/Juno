import { useState } from "react";
import type { ProjectSummary } from "@shared/types";
import { Icon } from "../../components/Icon";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { StatusBadge } from "../../components/StatusBadge";
import { useContextMenu } from "../../lib/use-context-menu";
import { formatCents, formatDate, LINK_ICONS, LINK_LABELS } from "./format";
import { ProjectCover } from "./ProjectCover";

type ProjectTableProps = {
	rows: ProjectSummary[];
	/**
	 * rows carries a thumbnail and a line of description. list is one 36px line
	 * each, which is the shape for two hundred projects and a narrow window.
	 */
	dense: boolean;
	onOpen: (project: ProjectSummary) => void;
	onRemove: (project: ProjectSummary) => void;
	onOpenFolder: (project: ProjectSummary) => void;
};

const HEADS = ["Project", "Client", "Status", "Due", "Value"];

/**
 * Rows are the structure. No outer border, no filled header, no card, per
 * brand/BRAND.md section 7. The two layouts share one table because the only
 * thing that differs is whether a row carries a thumbnail and a second line.
 */
export function ProjectTable({ rows, dense, onOpen, onRemove, onOpenFolder }: ProjectTableProps) {
	const menu = useContextMenu();
	// One menu for the whole table rather than one per row: two hundred rows
	// would otherwise each carry a portal that is closed.
	const [target, setTarget] = useState<ProjectSummary | null>(null);

	const items: MenuItem[] = target
		? [
				{ id: "open", label: "Open", icon: "projects", onSelect: () => onOpen(target) },
				{
					id: "folder",
					label: "Open the folder",
					icon: "folder-open",
					disabled: !target.localPath,
					onSelect: () => onOpenFolder(target),
				},
				{
					id: "delete",
					label: "Delete",
					icon: "remove",
					danger: true,
					separatorBefore: true,
					onSelect: () => onRemove(target),
				},
			]
		: [];

	return (
		<>
			<table className="w-full border-collapse">
				<thead>
					<tr>
						{HEADS.map((head) => (
							<th
								key={head}
								className={[
									"border-b border-[var(--line)] px-3 pb-2 text-[length:var(--text-micro)] font-[var(--weight-medium)] uppercase tracking-[0.06em] text-[var(--ink-faint)]",
									head === "Due" || head === "Value" ? "text-right" : "text-left",
								].join(" ")}
							>
								{head}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.id}
							onClick={() => onOpen(row)}
							onContextMenu={(event) => {
								setTarget(row);
								menu.open(event);
							}}
							className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
						>
							<td
								className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]"
								style={dense ? { height: "var(--row-height)" } : undefined}
							>
								<button
									type="button"
									onClick={() => onOpen(row)}
									className="flex w-full items-center gap-3 py-1 text-left"
								>
									{dense ? null : (
										<ProjectCover
											assetId={row.coverAssetId}
											name={row.name}
											compact
											className="h-[40px] w-[64px] flex-none rounded-[var(--radius-sm)] border border-[var(--line)]"
										/>
									)}
									<span className="min-w-0 flex-1">
										<span className="flex items-center gap-2">
											<span className="truncate">{row.name}</span>
											{row.linkKinds.map((kind) => (
												<span
													key={kind}
													title={LINK_LABELS[kind]}
													className="flex-none text-[var(--ink-faint)]"
												>
													<Icon name={LINK_ICONS[kind]} size={13} />
												</span>
											))}
										</span>
										{dense || !row.description ? null : (
											<span className="mt-0.5 block truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												{row.description}
											</span>
										)}
									</span>
								</button>
							</td>
							<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								<span className="block truncate">{row.clientName ?? "Your own work"}</span>
							</td>
							<td className="border-b border-[var(--line)] px-3 text-[length:var(--text-dense)]">
								{row.status ? (
									<StatusBadge label={row.status.label} tone={row.status.tone} />
								) : null}
							</td>
							<td className="tabular whitespace-nowrap border-b border-[var(--line)] px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{formatDate(row.dueOn)}
							</td>
							<td className="tabular whitespace-nowrap border-b border-[var(--line)] px-3 text-right text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{formatCents(row.agreedValueCents)}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{menu.at && target ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={target.name} />
			) : null}
		</>
	);
}
