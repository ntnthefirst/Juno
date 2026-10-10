import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { messageOf } from "../../lib/errors";

type ProjectNotesProps = {
	projectId: string;
	notes: string | null;
};

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/** Long enough that a sentence typed in one go is one write, short enough that a closed window loses nothing. */
const SAVE_DELAY_MS = 700;

/**
 * The project's own notes, written in place as Markdown and kept without a
 * save button.
 *
 * A note is typed in bursts and read far more often than it is edited, so a
 * form page in front of it would be ceremony. What is typed is written a
 * moment after the typing stops, and again when the page goes away, so
 * leaving mid-sentence keeps the sentence. The page behind it does not reload
 * on a save: the editor already shows what was written, and a reload would
 * push the stored copy back in under the cursor.
 */
export function ProjectNotes({ projectId, notes }: ProjectNotesProps) {
	const [text, setText] = useState(notes ?? "");
	const [save, setSave] = useState<SaveState>({ status: "idle" });
	// What is on disk, so an unchanged note is never written again.
	const storedRef = useRef(notes ?? "");
	const pendingRef = useRef<string | null>(null);
	const timerRef = useRef<number | null>(null);

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
			void window.juno.projects.update(projectId, { notes: next.trim() ? next : null }).catch(() => undefined);
		}
		return flush;
	}, [projectId]);

	function onChange(next: string) {
		setText(next);
		pendingRef.current = next;
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null;
			const value = pendingRef.current;
			pendingRef.current = null;
			if (value === null || value === storedRef.current) return;
			setSave({ status: "saving" });
			window.juno.projects
				.update(projectId, { notes: value.trim() ? value : null })
				.then(() => {
					storedRef.current = value;
					setSave({ status: "saved" });
				})
				.catch((cause: unknown) => setSave({ status: "error", message: messageOf(cause) }));
		}, SAVE_DELAY_MS);
	}

	return (
		<div>
			<MarkdownEditor
				value={text}
				onChange={onChange}
				rows={14}
				ariaLabel="Project notes"
				placeholder="Anything worth keeping about this project. Headings, lists and links work as you type."
			/>
			<p
				role={save.status === "error" ? "alert" : undefined}
				aria-live="polite"
				className={`mt-1 h-4 text-[length:var(--text-micro)] ${
					save.status === "error" ? "text-[var(--risk)]" : "text-[var(--ink-muted)]"
				}`}
			>
				{save.status === "saving"
					? "Saving"
					: save.status === "saved"
						? "Saved"
						: save.status === "error"
							? `Not saved. ${save.message}`
							: ""}
			</p>
		</div>
	);
}
