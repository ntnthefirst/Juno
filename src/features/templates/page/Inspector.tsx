import type { LayoutAlign, LayoutBlock, LayoutBox } from "@shared/types";
import { Button } from "../../../components/Button";
import { Field } from "../../../components/Field";
import { Select } from "../../../components/Select";
import { A4_WIDTH_MM } from "../../../lib/page-geometry";
import { BLOCK_KIND_LABELS } from "./layout-actions";

export type InspectorTarget =
	| { kind: "block"; block: LayoutBlock; canMoveUp: boolean; canMoveDown: boolean }
	| { kind: "box"; box: LayoutBox };

type InspectorProps = {
	target: InspectorTarget | null;
	onUpdateBlock: (patch: Partial<LayoutBlock>) => void;
	onMoveBlock: (direction: -1 | 1) => void;
	onUpdateBoxPosition: (patch: Partial<Pick<LayoutBox, "xMm" | "yMm" | "widthMm">>) => void;
	onDelete: () => void;
};

const ALIGN_OPTIONS: { value: LayoutAlign; label: string }[] = [
	{ value: "left", label: "Left" },
	{ value: "center", label: "Center" },
	{ value: "right", label: "Right" },
	{ value: "justify", label: "Justify" },
];

/** The fields for whichever block is selected, plus its position when it is a
 * box. This is the accessible path for moving a box: the fields work without
 * a pointer, which a canvas drag does not (styling.md section 7). */
export function Inspector({ target, onUpdateBlock, onMoveBlock, onUpdateBoxPosition, onDelete }: InspectorProps) {
	if (!target) {
		return (
			<div className="flex h-full flex-col gap-4 overflow-y-auto border-l border-[var(--line)] p-4">
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Select a block on the page to edit it.
				</p>
			</div>
		);
	}

	const block = target.kind === "block" ? target.block : target.box.block;

	return (
		<div className="flex h-full flex-col gap-5 overflow-y-auto border-l border-[var(--line)] p-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink)]">
					{BLOCK_KIND_LABELS[block.kind]}
				</p>
				<div className="flex gap-1">
					{target.kind === "block" ? (
						<>
							<Button
								size="dense"
								disabled={!target.canMoveUp}
								aria-label="Move block up"
								onClick={() => onMoveBlock(-1)}
							>
								Up
							</Button>
							<Button
								size="dense"
								disabled={!target.canMoveDown}
								aria-label="Move block down"
								onClick={() => onMoveBlock(1)}
							>
								Down
							</Button>
						</>
					) : null}
					<Button size="dense" variant="danger" onClick={onDelete}>
						Delete
					</Button>
				</div>
			</div>

			<BlockFields block={block} onUpdate={onUpdateBlock} />

			{target.kind === "box" ? (
				<BoxPositionFields box={target.box} onUpdate={onUpdateBoxPosition} />
			) : null}
		</div>
	);
}

type BlockFieldsProps = {
	block: LayoutBlock;
	onUpdate: (patch: Partial<LayoutBlock>) => void;
};

function BlockFields({ block, onUpdate }: BlockFieldsProps) {
	switch (block.kind) {
		case "heading":
			return (
				<div className="flex flex-col gap-4">
					<Field label="Text" value={block.text} onChange={(text) => onUpdate({ text })} />
					<Select
						label="Level"
						value={String(block.level)}
						onChange={(value) => onUpdate({ level: (Number(value) as 1 | 2 | 3) || 1 })}
						options={[
							{ value: "1", label: "1, largest" },
							{ value: "2", label: "2" },
							{ value: "3", label: "3, smallest" },
						]}
					/>
					<AlignField value={block.align} onChange={(align) => onUpdate({ align })} />
				</div>
			);
		case "paragraph":
			return (
				<div className="flex flex-col gap-4">
					<Field
						label="Text"
						value={block.html}
						onChange={(html) => onUpdate({ html })}
						multiline
						rows={6}
						help="strong, em, u, s, a href and {{ }} placeholders are kept. Everything else prints as typed."
					/>
					<AlignField value={block.align} onChange={(align) => onUpdate({ align })} />
				</div>
			);
		case "list":
			return <ListFields block={block} onUpdate={onUpdate} />;
		case "image":
			return (
				<div className="flex flex-col gap-4">
					<Field label="Image source" value={block.src} onChange={(src) => onUpdate({ src })} help="An https link, or a local file path." />
					<Field label="Alt text" value={block.alt} onChange={(alt) => onUpdate({ alt })} />
					<Field
						label="Width (mm)"
						type="number"
						tabular
						value={String(block.widthMm)}
						onChange={(value) => onUpdate({ widthMm: clampMm(value, block.widthMm, A4_WIDTH_MM) })}
					/>
					<AlignField value={block.align} onChange={(align) => onUpdate({ align })} />
				</div>
			);
		case "spacer":
			return (
				<Field
					label="Height (mm)"
					type="number"
					tabular
					value={String(block.heightMm)}
					onChange={(value) => onUpdate({ heightMm: clampMm(value, block.heightMm, 200) })}
				/>
			);
		case "divider":
			return (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					A rule drawn across the column. Nothing to set.
				</p>
			);
		case "table":
			return <TableFields block={block} onUpdate={onUpdate} />;
		case "signature":
			return (
				<div className="flex flex-col gap-4">
					<Field label="Label" value={block.label} onChange={(label) => onUpdate({ label })} help="Printed under the signature rule, for example handtekening opdrachtgever." />
					<Field
						label="Width (mm)"
						type="number"
						tabular
						value={String(block.widthMm)}
						onChange={(value) => onUpdate({ widthMm: clampMm(value, block.widthMm, A4_WIDTH_MM) })}
					/>
				</div>
			);
	}
}

type AlignFieldProps = {
	value: LayoutAlign;
	onChange: (align: LayoutAlign) => void;
};

function AlignField({ value, onChange }: AlignFieldProps) {
	return (
		<Select
			label="Alignment"
			value={value}
			onChange={(next) => onChange(next as LayoutAlign)}
			options={ALIGN_OPTIONS}
		/>
	);
}

type ListFieldsProps = {
	block: Extract<LayoutBlock, { kind: "list" }>;
	onUpdate: (patch: Partial<LayoutBlock>) => void;
};

function ListFields({ block, onUpdate }: ListFieldsProps) {
	function setItem(index: number, value: string) {
		const items = [...block.items];
		items[index] = value;
		onUpdate({ items });
	}

	function removeItem(index: number) {
		onUpdate({ items: block.items.filter((_, i) => i !== index) });
	}

	function addItem() {
		onUpdate({ items: [...block.items, ""] });
	}

	return (
		<div className="flex flex-col gap-4">
			<Select
				label="Style"
				value={block.ordered ? "ordered" : "bulleted"}
				onChange={(value) => onUpdate({ ordered: value === "ordered" })}
				options={[
					{ value: "bulleted", label: "Bulleted" },
					{ value: "ordered", label: "Numbered" },
				]}
			/>
			<div>
				<p className="mb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Items</p>
				<div className="flex flex-col gap-2">
					{block.items.map((item, index) => (
						<div key={index} className="flex items-start gap-1.5">
							<div className="flex-1">
								<Field label={`Item ${index + 1}`} value={item} onChange={(value) => setItem(index, value)} />
							</div>
							<div className="mt-5">
								<Button size="dense" variant="danger" aria-label={`Remove item ${index + 1}`} onClick={() => removeItem(index)}>
									Remove
								</Button>
							</div>
						</div>
					))}
				</div>
				<div className="mt-2">
					<Button size="dense" onClick={addItem}>
						Add item
					</Button>
				</div>
			</div>
		</div>
	);
}

type TableFieldsProps = {
	block: Extract<LayoutBlock, { kind: "table" }>;
	onUpdate: (patch: Partial<LayoutBlock>) => void;
};

function TableFields({ block, onUpdate }: TableFieldsProps) {
	function setColumnHeader(index: number, header: string) {
		const columns = block.columns.map((col, i) => (i === index ? { ...col, header } : col));
		onUpdate({ columns });
	}

	function setColumnWidth(index: number, widthPct: number) {
		const columns = block.columns.map((col, i) => (i === index ? { ...col, widthPct } : col));
		onUpdate({ columns });
	}

	function addColumn() {
		const columns = [...block.columns, { header: "", widthPct: 20 }];
		const rows = block.rows.map((row) => [...row, ""]);
		onUpdate({ columns, rows });
	}

	function removeColumn(index: number) {
		const columns = block.columns.filter((_, i) => i !== index);
		const rows = block.rows.map((row) => row.filter((_, i) => i !== index));
		onUpdate({ columns, rows });
	}

	function setCell(rowIndex: number, colIndex: number, value: string) {
		const rows = block.rows.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row));
		onUpdate({ rows });
	}

	function addRow() {
		onUpdate({ rows: [...block.rows, block.columns.map(() => "")] });
	}

	function removeRow(index: number) {
		onUpdate({ rows: block.rows.filter((_, i) => i !== index) });
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Header row</p>
				<Button size="dense" aria-pressed={block.headerRow} onClick={() => onUpdate({ headerRow: !block.headerRow })}>
					{block.headerRow ? "Shown" : "Hidden"}
				</Button>
			</div>

			<div>
				<p className="mb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Columns</p>
				<div className="flex flex-col gap-2">
					{block.columns.map((col, index) => (
						<div key={index} className="flex items-end gap-1.5">
							<div className="flex-1">
								<Field label={`Header ${index + 1}`} value={col.header} onChange={(value) => setColumnHeader(index, value)} />
							</div>
							<div className="w-[80px]">
								<Field
									label="Width %"
									type="number"
									tabular
									value={String(col.widthPct)}
									onChange={(value) => setColumnWidth(index, clampMm(value, col.widthPct, 100))}
								/>
							</div>
							<Button
								size="dense"
								variant="danger"
								aria-label={`Remove column ${index + 1}`}
								disabled={block.columns.length <= 1}
								onClick={() => removeColumn(index)}
							>
								Remove
							</Button>
						</div>
					))}
				</div>
				<div className="mt-2">
					<Button size="dense" onClick={addColumn}>
						Add column
					</Button>
				</div>
			</div>

			<div>
				<p className="mb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Rows</p>
				<div className="flex flex-col gap-3">
					{block.rows.map((row, rowIndex) => (
						<div key={rowIndex} className="rounded-[var(--radius-sm)] bg-[var(--sunken)] p-2">
							<div className="flex flex-col gap-2">
								{block.columns.map((col, colIndex) => (
									<Field
										key={colIndex}
										label={col.header || `Column ${colIndex + 1}`}
										value={row[colIndex] ?? ""}
										onChange={(value) => setCell(rowIndex, colIndex, value)}
									/>
								))}
							</div>
							<div className="mt-2">
								<Button size="dense" variant="danger" onClick={() => removeRow(rowIndex)}>
									Remove row {rowIndex + 1}
								</Button>
							</div>
						</div>
					))}
				</div>
				<div className="mt-2">
					<Button size="dense" onClick={addRow}>
						Add row
					</Button>
				</div>
			</div>
		</div>
	);
}

type BoxPositionFieldsProps = {
	box: LayoutBox;
	onUpdate: (patch: Partial<Pick<LayoutBox, "xMm" | "yMm" | "widthMm">>) => void;
};

function BoxPositionFields({ box, onUpdate }: BoxPositionFieldsProps) {
	return (
		<div className="border-t border-[var(--line)] pt-4">
			<p className="mb-3 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink)]">
				Position on the page
			</p>
			<div className="grid grid-cols-3 gap-2">
				<Field
					label="X (mm)"
					type="number"
					tabular
					value={String(box.xMm)}
					onChange={(value) => onUpdate({ xMm: clampMm(value, box.xMm, A4_WIDTH_MM) })}
				/>
				<Field
					label="Y (mm)"
					type="number"
					tabular
					value={String(box.yMm)}
					onChange={(value) => onUpdate({ yMm: clampMm(value, box.yMm, 297) })}
				/>
				<Field
					label="Width (mm)"
					type="number"
					tabular
					value={String(box.widthMm)}
					onChange={(value) => onUpdate({ widthMm: clampMm(value, box.widthMm, A4_WIDTH_MM) })}
				/>
			</div>
		</div>
	);
}

/** A number field's raw text, kept in range. An empty or unparseable value
 * falls back to what was there before, rather than snapping to zero while
 * someone is still typing a new figure. */
function clampMm(value: string, fallback: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, 0), max);
}
