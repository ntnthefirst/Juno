import { useEffect, useRef, useState } from "react";
import { DropImportDialog } from "../features/documents/DropImportDialog";
import { announceDocumentsChanged, carriesFiles } from "../lib/pdf-drop";

/**
 * Catches a file dropped anywhere in the window and asks which client it is for.
 *
 * Two jobs. The first is to stop the window navigating to a file that was let
 * go of over it, which is what Chromium does with a drop nothing has claimed,
 * and which the navigation rules would only turn into a blank refusal. The
 * second is the import. A client's own documents tab claims its drop before
 * this sees it, and this stays out of the way when that has happened.
 */
export function DocumentDropLayer() {
	const [hint, setHint] = useState(false);
	const [files, setFiles] = useState<File[] | null>(null);
	const hideTimer = useRef<number | undefined>(undefined);

	useEffect(() => {
		function over(event: DragEvent) {
			if (!carriesFiles(event) || event.defaultPrevented) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			setHint(true);
			// dragover repeats while a drag is over the window, so the hint goes
			// away when it stops rather than on a leave that is easy to miss.
			window.clearTimeout(hideTimer.current);
			hideTimer.current = window.setTimeout(() => setHint(false), 200);
		}

		function drop(event: DragEvent) {
			if (!carriesFiles(event) || event.defaultPrevented) return;
			event.preventDefault();
			window.clearTimeout(hideTimer.current);
			setHint(false);
			const dropped = Array.from(event.dataTransfer?.files ?? []);
			if (dropped.length > 0) setFiles(dropped);
		}

		window.addEventListener("dragover", over);
		window.addEventListener("drop", drop);
		return () => {
			window.removeEventListener("dragover", over);
			window.removeEventListener("drop", drop);
			window.clearTimeout(hideTimer.current);
		};
	}, []);

	return (
		<>
			{hint ? (
				<div
					aria-hidden
					className="pointer-events-none fixed inset-x-0 top-[var(--titlebar-height)] z-40 flex justify-center pt-4"
				>
					<p className="rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--surface)] px-4 py-2 text-[length:var(--text-base)] text-[var(--ink)] shadow-[var(--shadow-popover)]">
						Drop a PDF to import it
					</p>
				</div>
			) : null}
			{files ? (
				<DropImportDialog files={files} onClose={() => setFiles(null)} onImported={announceDocumentsChanged} />
			) : null}
		</>
	);
}
