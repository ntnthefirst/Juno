import { useEffect, useState } from "react";
import type { DocumentsFolder } from "@shared/types";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { SectionError } from "./Section";

type DocumentsFolderSectionProps = {
	onDone: (message: string) => void;
};

/**
 * Where new documents are written. The path is shown, not typed: a folder is
 * picked in a dialog in the main process, so a page never hands over a path.
 * Changing it moves nothing, and the line under it says so.
 */
export function DocumentsFolderSection({ onDone }: DocumentsFolderSectionProps) {
	const [folder, setFolder] = useState<DocumentsFolder | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.settings
			.getDocumentsFolder()
			.then((value) => {
				if (!cancelled) setFolder(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function run(action: () => Promise<DocumentsFolder | null>, message: string) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const next = await action();
			if (next) {
				setFolder(next);
				onDone(message);
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section data-setting="documents-folder">
			<p className="max-w-[62ch] text-base text-[var(--ink-muted)]">
				How Juno files and signs what it generates.
			</p>

			<div className="mt-5">
				<span className="mb-1.5 block text-sm font-[var(--weight-medium)] text-[var(--ink)]">
					Documents folder
				</span>
				<div className="flex items-center gap-2">
					<p
						data-selectable
						className="flex h-10 min-w-0 flex-1 items-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base"
					>
						<span className="min-w-0 truncate">{folder?.path ?? "Loading."}</span>
					</p>
					<Button
						disabled={busy || folder === null}
						onClick={() =>
							void run(() => window.juno.settings.chooseDocumentsFolder(), "Documents folder changed.")
						}
					>
						Choose folder
					</Button>
					{folder && !folder.isDefault ? (
						<Button
							disabled={busy}
							onClick={() =>
								void run(() => window.juno.settings.resetDocumentsFolder(), "Documents folder reset.")
							}
						>
							Use the default
						</Button>
					) : null}
				</div>
				<p className="mt-1.5 text-sm text-[var(--ink-muted)]">
					New documents are saved here. Files already saved stay where they are.
				</p>
			</div>

			<div className="mt-5">
				<p className="text-base text-[var(--ink)]">Every version is kept</p>
				<p className="mt-1 text-sm text-[var(--ink-muted)]">
					A new file never replaces an older one. It becomes the newest version.
				</p>
			</div>

			<SectionError message={error} />
		</section>
	);
}
