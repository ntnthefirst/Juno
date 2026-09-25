import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type InlineAddProps = {
	/** What it adds, for the tooltip and for a screen reader. "New mail template". */
	label: string;
	/** What goes in the box. "Template name". */
	placeholder: string;
	/** Named on screen while the name is being typed, one word. "Enter to create". */
	hint?: string;
	disabled?: boolean;
	busy?: boolean;
	/** Given the name that was typed. Closing is this component's job. */
	onSubmit: (name: string) => void;
};

/**
 * The plus that opens into the one field a new record needs.
 *
 * A screen has exactly one thing it creates and its heading already says what
 * that is, so the button is a glyph until it is pressed. Pressing it turns it
 * into the name box rather than into a form somewhere else: a name is the only
 * thing worth asking for before the record exists, and everything else is
 * edited on the record itself.
 *
 * The width is animated, which the styling rules otherwise keep away from
 * layout properties. One 32 pixel control growing into a field is the case
 * that rule is not about, and the movement is what makes the box read as the
 * same object the plus was.
 */
export function InlineAdd({
	label,
	placeholder,
	hint = "Enter to create",
	disabled = false,
	busy = false,
	onSubmit,
}: InlineAddProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) field.current?.focus();
	}, [open]);

	function close(): void {
		setOpen(false);
		setName("");
	}

	function submit(): void {
		const trimmed = name.trim();
		if (!trimmed) {
			close();
			return;
		}
		onSubmit(trimmed);
		close();
	}

	return (
		<div
			style={{ width: open ? 264 : 32 }}
			className="flex h-[32px] flex-none items-center overflow-hidden rounded-[var(--radius-md)] transition-[width] duration-[var(--duration-base)] ease-[var(--ease)]"
		>
			{open ? (
				<div className="flex h-[32px] w-full items-center gap-1 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--surface)] pr-1 pl-2">
					<input
						ref={field}
						value={name}
						disabled={busy}
						placeholder={placeholder}
						aria-label={label}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								submit();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								close();
							}
						}}
						// Leaving an empty box puts the plus back. Leaving a full one
						// keeps what was typed, because a click on the button beside it
						// is not a change of mind.
						onBlur={() => {
							if (!name.trim()) close();
						}}
						className="min-w-0 flex-1 bg-transparent text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
					/>
					<button
						type="button"
						aria-label={label}
						title={hint}
						disabled={busy || !name.trim()}
						onClick={submit}
						className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--accent)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-40"
					>
						<Icon name="check" size={14} />
					</button>
				</div>
			) : (
				<button
					type="button"
					aria-label={label}
					title={label}
					disabled={disabled}
					onClick={() => setOpen(true)}
					className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--accent)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-50"
				>
					<Icon name="add" size={16} />
				</button>
			)}
		</div>
	);
}
