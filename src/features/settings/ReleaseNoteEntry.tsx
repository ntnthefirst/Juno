import type { ReleaseNote } from "@shared/types";

type ReleaseNoteEntryProps = {
	note: ReleaseNote;
	/** Marks the version that is running, so the list says where you are. */
	current?: boolean;
	/** The heading level above this entry: the version is drawn as h3 inside a page. */
	compact?: boolean;
};

function formatDay(day: string | null): string | null {
	if (!day) return null;
	const at = new Date(`${day}T00:00:00`);
	if (Number.isNaN(at.getTime())) return null;
	return new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium" }).format(at);
}

/**
 * One version's notes: a summary, then short headed lists. The same shape in
 * the history and in the update that is waiting, so they read alike.
 */
export function ReleaseNoteEntry({ note, current = false, compact = false }: ReleaseNoteEntryProps) {
	const day = formatDay(note.releasedAt);

	return (
		<article aria-label={`Version ${note.version}`}>
			<header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<h3 className={compact ? "text-lg font-[var(--weight-semibold)]" : "text-h3"}>
					<span className="tabular">{note.version}</span>
				</h3>
				{current ? (
					<span className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-micro text-[var(--accent)]">
						Installed
					</span>
				) : null}
				{day ? <span className="tabular text-sm text-[var(--ink-muted)]">{day}</span> : null}
			</header>

			{note.summary ? (
				<p className="mt-2 max-w-[62ch] text-base text-[var(--ink)]">{note.summary}</p>
			) : null}

			{note.sections.map((section) => (
				<section key={section.title} className="mt-4">
					<h4 className="text-overline uppercase text-[var(--ink-muted)]">{section.title}</h4>
					<ul className="mt-2 flex max-w-[62ch] list-disc flex-col gap-1.5 pl-5 text-dense marker:text-[var(--ink-faint)]">
						{section.items.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</section>
			))}
		</article>
	);
}
