import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

export type ComboboxOption = {
	id: string;
	label: string;
	/** Muted text at the right of the row: a city, a status. */
	meta?: string | null;
};

type ComboboxProps = {
	/** The spoken name of the field. "Client". */
	label: string;
	options: ComboboxOption[];
	/** The chosen option's id, or null for none. */
	value: string | null;
	onChange: (id: string | null) => void;
	/** Shown in the field while nothing is chosen and the list is closed. */
	placeholder: string;
	/** Shown in the field while the list is open and nothing is typed. */
	searchPlaceholder: string;
	/** The row that clears the choice. "No client". */
	noneLabel: string;
	/**
	 * The words of the row that makes a new record from what was typed, or null
	 * to leave the row out. The row is never shown while nothing is typed.
	 */
	createLabel?: (typed: string) => string | null;
	/** Makes the record and chooses it. Called with the trimmed text. */
	onCreate?: (typed: string) => void | Promise<void>;
	/** Avatars are squares here: businesses and projects. Left out, rows have none. */
	avatars?: boolean;
	disabled?: boolean;
	id?: string;
	/** Told when the list opens and closes, for a row that makes room for it. */
	onOpenChange?: (open: boolean) => void;
};

/** A row of the list: an option, the "none" row or the "create" row. */
type Row = { kind: "option"; option: ComboboxOption } | { kind: "none" } | { kind: "create"; label: string };

/** How far below the field the list sits, and the most it grows to. */
const GAP = 4;
const MAX_HEIGHT = 280;

/** The label with the part that matches the typed text in semibold. */
function highlight(label: string, typed: string): ReactNode {
	if (typed.length === 0) return label;
	const at = label.toLocaleLowerCase().indexOf(typed.toLocaleLowerCase());
	if (at < 0) return label;
	return (
		<>
			{label.slice(0, at)}
			<span className="font-[var(--weight-semibold)]">{label.slice(at, at + typed.length)}</span>
			{label.slice(at + typed.length)}
		</>
	);
}

/**
 * A field you type into to pick one record from a long list, with a way to
 * pick none and a way to make the record when it is not there yet (design
 * frames 184:142 and 184:270). It is one text input with the combobox role and
 * a listbox under it: arrow keys move through the rows, Enter picks, Escape
 * closes the list without leaving the field, and typing filters.
 *
 * The list is placed with fixed positioning under the field, so a form body
 * that scrolls does not clip it.
 */
export function Combobox({
	label,
	options,
	value,
	onChange,
	placeholder,
	searchPlaceholder,
	noneLabel,
	createLabel,
	onCreate,
	avatars = false,
	disabled = false,
	id,
	onOpenChange,
}: ComboboxProps) {
	const ownId = useId();
	const inputId = id ?? ownId;
	const listId = `${inputId}-list`;
	const fieldRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const [open, setOpenState] = useState(false);
	const [typed, setTyped] = useState("");
	// Null until the arrow keys or the pointer pick a row: then the first match
	// is the one Enter takes, or the create row when nothing matches.
	const [picked, setActive] = useState<number | null>(null);
	const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

	function setOpen(next: boolean) {
		setOpenState(next);
		onOpenChange?.(next);
	}

	const chosen = options.find((option) => option.id === value) ?? null;
	const query = typed.trim();

	const rows = useMemo<Row[]>(() => {
		const needle = query.toLocaleLowerCase();
		const matches = needle.length === 0 ? options : options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
		const out: Row[] = matches.map((option) => ({ kind: "option", option }));
		out.push({ kind: "none" });
		const create = query.length > 0 && onCreate && createLabel ? createLabel(query) : null;
		if (create) out.push({ kind: "create", label: create });
		return out;
	}, [options, query, onCreate, createLabel]);

	const firstMatch = rows[0]?.kind === "option" ? 0 : rows.findIndex((row) => row.kind === "create");
	const active = picked !== null && picked < rows.length ? picked : Math.max(0, query.length > 0 ? firstMatch : 0);

	// The list is drawn against the window, under the field, or over it when
	// the window has no room below.
	useLayoutEffect(() => {
		if (!open) return;
		function measure() {
			const field = fieldRef.current;
			if (!field) return;
			const rect = field.getBoundingClientRect();
			const below = window.innerHeight - rect.bottom - GAP * 2;
			const above = rect.top - GAP * 2;
			const height = Math.min(MAX_HEIGHT, listRef.current?.scrollHeight ?? MAX_HEIGHT);
			const flip = below < height && above > below;
			const maxHeight = Math.min(MAX_HEIGHT, flip ? above : below);
			setPlace({
				top: flip ? rect.top - GAP - Math.min(height, maxHeight) : rect.bottom + GAP,
				left: rect.left,
				width: rect.width,
				maxHeight,
			});
		}
		measure();
		window.addEventListener("resize", measure);
		// Capture, so a scroll in the form body moves the list with the field.
		window.addEventListener("scroll", measure, true);
		return () => {
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, [open, rows.length]);

	// The active row stays in view while the arrow keys walk past the edge.
	useLayoutEffect(() => {
		if (!open) return;
		listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [open, active]);

	function openList() {
		if (disabled) return;
		setOpen(true);
		const current = rows.findIndex((row) =>
			value === null ? row.kind === "none" : row.kind === "option" && row.option.id === value,
		);
		setActive(Math.max(0, current));
	}

	function close() {
		setOpen(false);
		setTyped("");
		setPlace(null);
	}

	async function pick(row: Row) {
		if (row.kind === "option") onChange(row.option.id);
		else if (row.kind === "none") onChange(null);
		else if (onCreate) {
			const name = query;
			close();
			await onCreate(name);
			return;
		}
		close();
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!open) {
				openList();
				return;
			}
			const step = event.key === "ArrowDown" ? 1 : -1;
			setActive((active + step + rows.length) % rows.length);
		} else if (event.key === "Home" && open) {
			event.preventDefault();
			setActive(0);
		} else if (event.key === "End" && open) {
			event.preventDefault();
			setActive(rows.length - 1);
		} else if (event.key === "Enter" && open) {
			// Picks the row instead of submitting the form the field sits in.
			event.preventDefault();
			const row = rows[active];
			if (row) void pick(row);
		} else if (event.key === "Escape" && open) {
			// Closes the list and nothing else: a window that closes on Escape
			// checks defaultPrevented before it does.
			event.preventDefault();
			close();
		} else if (event.key === "Tab" && open) {
			close();
		}
	}

	const activeRow = open ? rows[active] : undefined;
	const showAvatar = avatars && !open && chosen !== null;

	return (
		<div
			ref={fieldRef}
			className={[
				"flex h-9 min-w-0 items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--surface)] pr-2.5 pl-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
				// The ring is the field's own border, drawn at two pixels in the
				// focus colour, as the design draws a field being typed in.
				"focus-within:border-[var(--focus)] focus-within:shadow-[inset_0_0_0_1px_var(--focus)]",
				open ? "border-[var(--focus)] shadow-[inset_0_0_0_1px_var(--focus)]" : "border-[var(--line-strong)]",
				disabled ? "opacity-50" : "",
			].join(" ")}
			onMouseDown={(event) => {
				// A press anywhere on the field types into it, the chevron included.
				// The list is inside this element too, and handles its own presses.
				const target = event.target as Node;
				if (listRef.current?.contains(target)) return;
				if (target !== inputRef.current) {
					event.preventDefault();
					inputRef.current?.focus();
					if (open) close();
					else openList();
				}
			}}
		>
			{showAvatar ? (
				<Avatar name={chosen.label} size={20} shape="square" />
			) : (
				<Icon name="search" className="flex-none text-[var(--ink)]" />
			)}
			<input
				ref={inputRef}
				id={inputId}
				type="text"
				role="combobox"
				aria-label={label}
				aria-expanded={open}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={activeRow ? `${listId}-${active}` : undefined}
				autoComplete="off"
				spellCheck={false}
				disabled={disabled}
				value={open ? typed : (chosen?.label ?? "")}
				placeholder={open ? searchPlaceholder : placeholder}
				onChange={(event) => {
					setTyped(event.target.value);
					setActive(null);
					if (!open) setOpen(true);
				}}
				onMouseDown={() => {
					if (!open) openList();
				}}
				onFocus={(event) => event.target.select()}
				onBlur={close}
				onKeyDown={onKeyDown}
				className="min-w-0 flex-1 bg-transparent text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
			/>
			<Icon name="chevron-down" className="flex-none text-[var(--ink)]" />

			{open ? (
				<ul
					ref={listRef}
					id={listId}
					role="listbox"
					aria-label={label}
					// Keeps the focus in the input while a row is pressed.
					onMouseDown={(event) => event.preventDefault()}
					style={
						place
							? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }
							: { visibility: "hidden" }
					}
					className="animate-scale fixed z-[61] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--shadow-popover)]"
				>
					{rows.map((row, index) => {
						const isActive = index === active;
						const optionId = `${listId}-${index}`;
						const base = `flex cursor-default items-center gap-2.5 rounded-[var(--radius-sm)] px-2 text-base ${isActive ? "bg-[var(--hover)]" : ""}`;
						if (row.kind === "option") {
							return (
								<li
									key={row.option.id}
									id={optionId}
									data-index={index}
									role="option"
									aria-selected={row.option.id === value}
									onMouseEnter={() => setActive(index)}
									onClick={() => void pick(row)}
									className={`${base} h-9 text-[var(--ink)]`}
								>
									{avatars ? <Avatar name={row.option.label} size={20} shape="square" /> : null}
									<span className="min-w-0 flex-1 truncate">{highlight(row.option.label, query)}</span>
									{row.option.meta ? (
										<span className="flex-none text-sm text-[var(--ink-muted)]">{row.option.meta}</span>
									) : null}
								</li>
							);
						}
						const first = row.kind === "none";
						return (
							<li
								key={row.kind}
								id={optionId}
								data-index={index}
								role="option"
								aria-selected={row.kind === "none" ? value === null : false}
								onMouseEnter={() => setActive(index)}
								onClick={() => void pick(row)}
								className={[
									base,
									"relative h-8",
									// The divider above the two fixed rows, drawn inside the first
									// so the listbox holds options only.
									first && index > 0 ? "mt-px before:absolute before:inset-x-0 before:-top-px before:h-px before:bg-[var(--line)]" : "",
									row.kind === "none" ? "text-[var(--ink-muted)]" : "text-[var(--accent)]",
								].join(" ")}
							>
								{row.kind === "none" ? (
									noneLabel
								) : (
									<>
										<Icon name="add" size={14} className="flex-none" />
										<span className="min-w-0 flex-1 truncate">{row.label}</span>
									</>
								)}
							</li>
						);
					})}
				</ul>
			) : null}
		</div>
	);
}
