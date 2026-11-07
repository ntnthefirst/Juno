import { Button } from "../../../components/Button";
import { Segmented } from "../../../components/Segmented";
import { BLOCK_KINDS, BLOCK_KIND_LABELS, type BlockKind } from "./layout-actions";

export type PlacementMode = "flow" | "box";

type InsertToolbarProps = {
	placement: PlacementMode;
	onPlacementChange: (mode: PlacementMode) => void;
	onInsertBlock: (kind: BlockKind) => void;
	activePageNumber: number;
	pageCount: number;
	onAddPage: () => void;
	onDeletePage: () => void;
	canDeletePage: boolean;
};

/**
 * Adding a block always targets the active page, named here so the choice of
 * flow-versus-box reads next to it rather than as a separate, disconnected
 * setting.
 */
export function InsertToolbar({
	placement,
	onPlacementChange,
	onInsertBlock,
	activePageNumber,
	pageCount,
	onAddPage,
	onDeletePage,
	canDeletePage,
}: InsertToolbarProps) {
	return (
		<div className="flex h-full flex-col gap-6 overflow-y-auto border-r border-[var(--line)] p-4">
			<div>
				<p className="mb-2 text-sm text-[var(--ink-muted)]">
					Adding to page {activePageNumber} of {pageCount}
				</p>
				<Segmented
					size="compact"
					fill
					label="Where a new block goes"
					value={placement}
					onChange={onPlacementChange}
					options={[
						{ id: "flow", label: "In the flow" },
						{ id: "box", label: "On the page" },
					]}
				/>
			</div>

			<div>
				<p className="mb-2 text-sm text-[var(--ink-muted)]">Add a block</p>
				<div className="flex flex-col gap-1.5">
					{BLOCK_KINDS.map((kind) => (
						// A plain button rather than the shared Button component: this is a
						// row in a list, not a call to action, and Button always centres
						// its label, which is exactly what makes an eight-item rail of
						// full-width buttons read as banners rather than rows.
						<button
							key={kind}
							type="button"
							onClick={() => onInsertBlock(kind)}
							className="flex h-[32px] w-full shrink-0 items-center justify-start gap-2 rounded-[var(--radius-md)] px-2 text-left text-dense font-[var(--weight-medium)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
						>
							Add {BLOCK_KIND_LABELS[kind].toLowerCase()}
						</button>
					))}
				</div>
			</div>

			<div className="mt-auto">
				<p className="mb-2 text-sm text-[var(--ink-muted)]">Pages</p>
				<div className="flex flex-col gap-1.5">
					<Button size="dense" onClick={onAddPage}>
						Add page
					</Button>
					<Button size="dense" disabled={!canDeletePage} onClick={onDeletePage}>
						Delete page {activePageNumber}
					</Button>
				</div>
			</div>
		</div>
	);
}
