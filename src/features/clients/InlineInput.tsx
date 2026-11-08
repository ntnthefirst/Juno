import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { messageOf } from "../../lib/errors";

type InlineInputProps = {
	/** What the field starts with. Saving it unchanged is a cancel. */
	initial: string;
	ariaLabel: string;
	type?: "text" | "email" | "tel" | "url";
	placeholder?: string;
	/** A fixed set to pick from, drawn as a select. Picking one saves it. */
	options?: ReadonlyArray<{ value: string; label: string }>;
	/** Writes the value through the service. A throw keeps the field open with the message under it. */
	onCommit: (value: string) => Promise<void>;
	onCancel: () => void;
};

const FIELD =
	"h-8 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)] aria-invalid:border-[var(--risk)]";

/**
 * One value edited where it is shown: a 32px field with the focus ring and a
 * hint beside it. Enter saves, Escape cancels, and leaving the field saves
 * what changed or cancels when nothing did, so a typed value is never thrown
 * away by a click elsewhere.
 */
export function InlineInput({
	initial,
	ariaLabel,
	type = "text",
	placeholder,
	options,
	onCommit,
	onCancel,
}: InlineInputProps) {
	const [value, setValue] = useState(initial);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const selectRef = useRef<HTMLSelectElement>(null);
	// Escape blurs the field on its way out, and that blur must not save.
	const doneRef = useRef(false);

	useEffect(() => {
		if (options) selectRef.current?.focus();
		else {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [options]);

	async function commit(next: string) {
		if (busy || doneRef.current) return;
		if (next.trim() === initial.trim()) {
			doneRef.current = true;
			onCancel();
			return;
		}
		setBusy(true);
		setProblem(null);
		try {
			await onCommit(next.trim());
			doneRef.current = true;
		} catch (cause: unknown) {
			setProblem(messageOf(cause));
			setBusy(false);
		}
	}

	function cancel() {
		doneRef.current = true;
		onCancel();
	}

	function onKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			cancel();
		} else if (event.key === "Enter" && !options) {
			event.preventDefault();
			void commit(value);
		}
	}

	return (
		<div className="min-w-0 flex-1 py-0.5">
			<div className="flex items-center gap-2">
				{options ? (
					<select
						ref={selectRef}
						aria-label={ariaLabel}
						value={value}
						disabled={busy}
						onChange={(event) => {
							setValue(event.target.value);
							void commit(event.target.value);
						}}
						onKeyDown={onKeyDown}
						onBlur={cancel}
						className={FIELD}
					>
						{options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				) : (
					<input
						ref={inputRef}
						type={type}
						aria-label={ariaLabel}
						aria-invalid={problem ? true : undefined}
						placeholder={placeholder}
						value={value}
						readOnly={busy}
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={onKeyDown}
						onBlur={() => void commit(value)}
						className={`${FIELD} ${type === "tel" ? "tabular" : ""}`}
					/>
				)}
				<span className="flex-none text-sm whitespace-nowrap text-[var(--ink-muted)]">
					{options ? "Esc cancels" : "Enter saves, Esc cancels"}
				</span>
			</div>
			{problem ? (
				<p role="alert" data-selectable className="mt-1 text-sm text-[var(--risk)]">
					{problem}
				</p>
			) : null}
		</div>
	);
}
