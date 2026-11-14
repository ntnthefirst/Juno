import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import { FileName } from "../../components/FileName";
import { formatBytes } from "../projects/format";
import { SpecimenMark } from "./SpecimenMark";
import { countWithin } from "./explorer-tree";
import { nameOf, sizeOf, typeOf, type ExplorerItem } from "./explorer-items";
import { STATUS_TONES, statusOf } from "./item-status";
import { RenameField } from "./RenameField";
import { TileThumb } from "./TileThumb";

type ExplorerTileProps = {
	item: ExplorerItem;
	bind: ButtonHTMLAttributes<HTMLButtonElement> & { ref: Ref<HTMLButtonElement> };
	selected: boolean;
	cut: boolean;
	dropping: boolean;
	renaming: boolean;
	onRename: (name: string) => void;
	onRenameEnd: () => void;
	statusLabels: ReadonlyMap<string, string>;
	/** The arrival delay, so a folder of tiles comes in one after another. */
	style: CSSProperties;
	/** Reads its picture at once instead of when it comes near the screen. */
	eager: boolean;
};

/** The line under a tile's name: a folder's count, or a file's type and size. */
function metaOf(item: ExplorerItem): string {
	if (item.kind === "node") {
		const count = countWithin(item.node);
		return `${count} ${count === 1 ? "item" : "items"}`;
	}
	const size = sizeOf(item);
	return [typeOf(item), size === null ? "" : formatBytes(size)].filter(Boolean).join(" · ");
}

/** A file as a tile: a picture of it, its name and one line of what it is. */
export function ExplorerTile({ item, bind, selected, cut, dropping, renaming, onRename, onRenameEnd, statusLabels, style, eager }: ExplorerTileProps) {
	const status = statusOf(item, statusLabels);
	return (
		<button
			type="button"
			{...bind}
			style={style}
			className={`animate-rise flex w-full min-w-0 cursor-default flex-col gap-2 rounded-[var(--radius-lg)] border p-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
				dropping
					? "border-[var(--accent)] bg-[var(--accent-soft)]"
					: selected
						? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
						: "border-transparent hover:bg-[var(--hover)]"
			} ${cut ? "opacity-55" : ""}`}
		>
			<TileThumb item={item} eager={eager} />
			<span className="flex min-w-0 flex-col gap-0.5 px-1 pb-0.5">
				<span className="flex min-w-0 items-center gap-1.5 text-dense">
					{renaming ? (
						<RenameField value={nameOf(item)} onCommit={onRename} onCancel={onRenameEnd} />
					) : (
						<FileName name={nameOf(item)} />
					)}
					{item.kind === "document" && item.record.isSpecimen ? <SpecimenMark /> : null}
				</span>
				<span className="tabular flex min-w-0 items-center gap-1.5 text-sm text-[var(--ink-muted)]">
					<span className="min-w-0 truncate">{metaOf(item)}</span>
					{status ? (
						<>
							<span aria-hidden>·</span>
							<span className={`flex-none ${STATUS_TONES[status.tone]}`}>{status.text}</span>
						</>
					) : null}
				</span>
			</span>
		</button>
	);
}
