import { useEffect, useState } from "react";
import type { ReleaseNote } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { ReleaseNoteEntry } from "./ReleaseNoteEntry";
import { Section, SectionError } from "./Section";

/** Every version's notes, newest first. Read-only. */
export function ReleaseNotesSection() {
	const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
	const [version, setVersion] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.updates.releaseNotes(), window.juno.updates.status()])
			.then(([list, status]) => {
				if (cancelled) return;
				setNotes(list);
				setVersion(status.currentVersion);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Section
			title="Release notes"
			anchor="release-notes"
			description="What each version of Juno changed, newest first."
		>
			{notes === null ? (
				error ? null : <p className="text-[var(--ink-muted)]">Loading.</p>
			) : notes.length === 0 ? (
				<p className="text-[var(--ink-muted)]">This build came without release notes.</p>
			) : (
				<div className="flex flex-col">
					{notes.map((note, index) => (
						<div
							key={note.version}
							className={index === 0 ? "" : "mt-6 border-t border-[var(--line)] pt-6"}
						>
							<ReleaseNoteEntry note={note} current={note.version === version} />
						</div>
					))}
				</div>
			)}
			<SectionError message={error} />
		</Section>
	);
}
