import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MarkdownEditor } from "./MarkdownEditor";
import { messageOf } from "../lib/errors";

type InlineNotesProps = {
	/** What is stored now. Read once, when the editor mounts; key the component by record to start over. */
	notes: string | null;
	/** Writes the notes through the record's own service. Null clears them. */
	save: (notes: string | null) => Promise<unknown>;
	ariaLabel: string;
	placeholder?: string;
	rows?: number;
	/** The format bar above the text, and a field border around both. */
	toolbar?: boolean;
	/**
	 * A heading drawn above the editor, with the save status at its right. Without
	 * one, the status sits under the editor instead.
	 */
	title?: string;
};

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/** Long enough that a sentence typed in one go is one write, short enough that a closed window loses nothing. */
const SAVE_DELAY_MS = 700;

/**
 * A record's own notes, written in place as Markdown and kept without a save
 * button.
 *
 * A note is typed in bursts and read far more often than it is edited, so a
 * form page in front of it would be ceremony. What is typed is written a
 * moment after the typing stops, and again when the editor goes away, so
 * leaving mid-sentence keeps the sentence. The page behind it does not reload
 * on a save: the editor already shows what was written, and a reload would
 * push the stored copy back in under the cursor.
 */
export function InlineNotes({ notes, save, ariaLabel, placeholder, rows = 14, toolbar = false, title }: InlineNotesProps) {
	const [text, setText] = useState(notes ?? "");
	const [state, setState] = useState<SaveState>({ status: "idle" });
	// What is on disk, so an unchanged note is never written again.
	const storedRef = useRef(notes ?? "");
	const pendingRef = useRef<string | null>(null);
	const timerRef = useRef<number | null>(null);
	// The latest save, so the flush on the way out does not depend on the caller
	// handing over the same function on every render.
	const saveRef = useRef(save);
	useLayoutEffect(() => {
		saveRef.current = save;
	});

	useEffect(() => {
		function flush() {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			const next = pendingRef.current;
			pendingRef.current = null;
			if (next === null || next === storedRef.current) return;
			storedRef.current = next;
			void saveRef.current(next.trim() ? next : null).catch(() => undefined);
		}
		return flush;
	}, []);

	function onChange(next: string) {
		setText(next);
		pendingRef.current = next;
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null;
			const value = pendingRef.current;
			pendingRef.current = null;
			if (value === null || value === storedRef.current) return;
			setState({ status: "saving" });
			saveRef
				.current(value.trim() ? value : null)
				.then(() => {
					storedRef.current = value;
					setState({ status: "saved" });
				})
				.catch((cause: unknown) => setState({ status: "error", message: messageOf(cause) }));
		}, SAVE_DELAY_MS);
	}

	const status =
		state.status === "saving"
			? "Saving"
			: state.status === "saved"
				? "Saved"
				: state.status === "error"
					? `Not saved. ${state.message}`
					: "";
	const statusClass = state.status === "error" ? "text-[var(--risk)]" : "text-[var(--ink-muted)]";

	const editor = (
		<MarkdownEditor
			value={text}
			onChange={onChange}
			rows={rows}
			ariaLabel={ariaLabel}
			placeholder={placeholder}
			toolbar={toolbar}
		/>
	);

	if (title) {
		return (
			<div>
				<div className="mb-2 flex items-center justify-between gap-4">
					<h3 className="text-h3">{title}</h3>
					<p
						role={state.status === "error" ? "alert" : undefined}
						aria-live="polite"
						className={`min-w-0 truncate text-sm ${statusClass}`}
					>
						{status}
					</p>
				</div>
				{editor}
			</div>
		);
	}

	return (
		<div>
			{editor}
			<p
				role={state.status === "error" ? "alert" : undefined}
				aria-live="polite"
				className={`mt-1 h-4 text-micro ${statusClass}`}
			>
				{status}
			</p>
		</div>
	);
}
