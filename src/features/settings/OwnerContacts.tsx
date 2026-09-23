import { useState } from "react";
import { Button } from "../../components/Button";

/** The shape both OwnerEmail and OwnerPhone share, which is all this list needs. */
export type OwnerContactRow = {
	id: string;
	label: string | null;
	isPrimary: boolean;
};

type OwnerContactListProps<T extends OwnerContactRow> = {
	items: T[];
	/** Reads the address or the number off a row. The one field the two types don't share. */
	getValue: (item: T) => string;
	inputType: "email" | "tel";
	/** Accessible name for the bare value input, since the row carries no visible label. */
	valueLabel: string;
	valuePlaceholder: string;
	labelPlaceholder: string;
	emptyText: string;
	/** Lower-cased values to mark as coming from a configured mail account. */
	markedValues?: ReadonlySet<string>;
	markedText?: string;
	onAdd: (value: string, label: string | null) => Promise<void>;
	onUpdate: (id: string, value: string, label: string | null) => Promise<void>;
	onMakePrimary: (id: string) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
};

const ROW_INPUT =
	"h-8 min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] disabled:opacity-60";

/**
 * One list, reused for the owner's emails and phones. Both are one value plus
 * an optional label plus a primary flag, and editing either is the same shape:
 * a row with two fields and save or cancel, never a dialog (styling.md 5c).
 */
export function OwnerContactList<T extends OwnerContactRow>({
	items,
	getValue,
	inputType,
	valueLabel,
	valuePlaceholder,
	labelPlaceholder,
	emptyText,
	markedValues,
	markedText,
	onAdd,
	onUpdate,
	onMakePrimary,
	onRemove,
}: OwnerContactListProps<T>) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");
	const [editLabel, setEditLabel] = useState("");
	const [editBusy, setEditBusy] = useState(false);
	const [newValue, setNewValue] = useState("");
	const [newLabel, setNewLabel] = useState("");
	const [addBusy, setAddBusy] = useState(false);

	function startEdit(item: T) {
		setEditingId(item.id);
		setEditValue(getValue(item));
		setEditLabel(item.label ?? "");
	}

	return (
		<div>
			{items.length === 0 ? (
				<p className="text-[var(--ink-muted)]">{emptyText}</p>
			) : (
				<ul className="flex flex-col">
					{items.map((item) => {
						const value = getValue(item);
						const marked = markedValues ? markedValues.has(value.toLowerCase()) : false;

						if (editingId === item.id) {
							return (
								<li
									key={item.id}
									className="flex items-center border-b border-[var(--line)]/60 py-1 last:border-b-0"
									style={{ minHeight: "var(--row-height)" }}
								>
									<form
										className="flex flex-1 flex-wrap items-center gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											const trimmed = editValue.trim();
											if (!trimmed || editBusy) return;
											const id = item.id;
											setEditingId(null);
											setEditBusy(true);
											void onUpdate(id, trimmed, editLabel.trim() || null).finally(() =>
												setEditBusy(false),
											);
										}}
									>
										<input
											type={inputType}
											value={editValue}
											onChange={(event) => setEditValue(event.target.value)}
											placeholder={valuePlaceholder}
											aria-label={valueLabel}
											className={`${ROW_INPUT} flex-1`}
										/>
										<input
											type="text"
											value={editLabel}
											onChange={(event) => setEditLabel(event.target.value)}
											placeholder={labelPlaceholder}
											aria-label="Label"
											className={`${ROW_INPUT} w-32 flex-none`}
										/>
										<Button
											size="dense"
											type="submit"
											variant="primary"
											disabled={editBusy || editValue.trim().length === 0}
										>
											Save
										</Button>
										<Button size="dense" type="button" onClick={() => setEditingId(null)}>
											Cancel
										</Button>
									</form>
								</li>
							);
						}

						return (
							<li
								key={item.id}
								className="flex items-center gap-3 border-b border-[var(--line)]/60 py-1 last:border-b-0"
								style={{ minHeight: "var(--row-height)" }}
							>
								<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
									{value}
									{item.label ? (
										<span className="ml-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{item.label}
										</span>
									) : null}
								</span>
								{item.isPrimary ? (
									<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[length:var(--text-micro)] text-[var(--accent)]">
										Primary
									</span>
								) : null}
								{marked ? (
									<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-faint)]">
										{markedText}
									</span>
								) : null}
								<span className="flex shrink-0 gap-1">
									{!item.isPrimary ? (
										<Button size="dense" onClick={() => void onMakePrimary(item.id)}>
											Make primary
										</Button>
									) : null}
									<Button size="dense" onClick={() => startEdit(item)}>
										Edit
									</Button>
									<Button size="dense" variant="danger" onClick={() => void onRemove(item.id)}>
										Remove
									</Button>
								</span>
							</li>
						);
					})}
				</ul>
			)}

			<form
				className="mt-3 flex flex-wrap items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const trimmed = newValue.trim();
					if (!trimmed || addBusy) return;
					setNewValue("");
					setNewLabel("");
					setAddBusy(true);
					void onAdd(trimmed, newLabel.trim() || null).finally(() => setAddBusy(false));
				}}
			>
				<input
					type={inputType}
					value={newValue}
					onChange={(event) => setNewValue(event.target.value)}
					placeholder={valuePlaceholder}
					aria-label={valueLabel}
					className={`${ROW_INPUT} w-64`}
				/>
				<input
					type="text"
					value={newLabel}
					onChange={(event) => setNewLabel(event.target.value)}
					placeholder={labelPlaceholder}
					aria-label="Label"
					className={`${ROW_INPUT} w-32 flex-none`}
				/>
				<Button size="dense" variant="primary" type="submit" disabled={addBusy || newValue.trim().length === 0}>
					Add
				</Button>
			</form>
		</div>
	);
}
