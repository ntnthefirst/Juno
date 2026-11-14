import type { ButtonHTMLAttributes, Ref } from "react";
import { FileName } from "../../components/FileName";
import { modifiedLabel } from "../../lib/modified-label";
import { formatBytes } from "../projects/format";
import { belongsTo } from "./belongs-to";
import { SpecimenMark } from "./SpecimenMark";
import { modifiedOf, nameOf, sizeOf, typeOf, type ExplorerItem } from "./explorer-items";
import { ExplorerIcon } from "./ExplorerIcon";
import { STATUS_TONES, statusOf } from "./item-status";
import { OFFSCREEN_ROW } from "./offscreen-row";
import { RenameField } from "./RenameField";

type ExplorerRowProps = {
	item: ExplorerItem;
	/** The button's own handlers and state, from the list that owns the selection. */
	bind: ButtonHTMLAttributes<HTMLButtonElement> & { ref: Ref<HTMLButtonElement> };
	columns: string;
	selected: boolean;
	/** Cut and waiting for a paste: drawn faded, as a file manager does. */
	cut: boolean;
	/** A drag is over this folder row. */
	dropping: boolean;
	renaming: boolean;
	onRename: (name: string) => void;
	onRenameEnd: () => void;
	statusLabels: ReadonlyMap<string, string>;
	showWhere: boolean;
};

/** Where a document is kept, for a search result that is not in the open folder. */
function whereOf(item: ExplorerItem): string {
	if (item.kind !== "document") return "";
	return item.record.clientName || item.record.projectName ? belongsTo(item.record) : "Unfiled";
}

/**
 * One row of the list: what it is, its name, type, size, when it changed, its
 * status and how many versions it has. 36px, and the numbers line up.
 */
export function ExplorerRow({
	item,
	bind,
	columns,
	selected,
	cut,
	dropping,
	renaming,
	onRename,
	onRenameEnd,
	statusLabels,
	showWhere,
}: ExplorerRowProps) {
	const status = statusOf(item, statusLabels);
	const size = sizeOf(item);
	const versions = item.kind === "document" && item.record.sourceKind !== "page" ? item.record.versionCount : null;

	return (
		<button
			type="button"
			{...bind}
			style={{ gridTemplateColumns: columns, height: "var(--row-height)", ...OFFSCREEN_ROW }}
			className={`grid w-full cursor-default items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)] ${
				dropping
					? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] ring-inset"
					: selected
						? "bg-[var(--accent-soft)]"
						: "hover:bg-[var(--hover)]"
			} ${cut ? "opacity-55" : ""}`}
		>
			<span className="flex min-w-0 items-center gap-2.5">
				<span className="flex w-5 flex-none justify-center">
					<ExplorerIcon item={item} size={16} />
				</span>
				{renaming ? (
					<RenameField value={nameOf(item)} onCommit={onRename} onCancel={onRenameEnd} />
				) : (
					<FileName name={nameOf(item)} className={selected ? "text-[var(--ink)]" : ""} />
				)}
				{item.kind === "document" && item.record.isSpecimen ? <SpecimenMark /> : null}
			</span>
			{showWhere ? <span className="min-w-0 truncate text-[var(--ink-muted)]">{whereOf(item)}</span> : null}
			<span className="min-w-0 truncate text-[var(--ink-muted)]">{typeOf(item)}</span>
			<span className="tabular truncate text-right text-[var(--ink-muted)]">{size === null ? "" : formatBytes(size)}</span>
			<span className="tabular truncate text-[var(--ink-muted)]">{modifiedLabel(modifiedOf(item))}</span>
			<span className={`min-w-0 truncate ${status ? STATUS_TONES[status.tone] : ""}`}>{status?.text ?? ""}</span>
			<span className="tabular text-right text-[var(--ink-muted)]">{versions ?? ""}</span>
		</button>
	);
}
