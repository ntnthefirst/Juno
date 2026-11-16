import { useMemo, useState } from "react";
import type { TextDiffPart } from "@shared/types";
import { diffSegments } from "./diff-runs";

type TextDiffViewProps = {
	parts: TextDiffPart[];
	/** The two sides, named the way the comparison names them. */
	addedLabel: string;
	removedLabel: string;
	truncated: boolean;
};

/**
 * The words of the two files as one text: what the file being added says and
 * the one in Juno does not on a green tint, what it leaves out struck through
 * on a red one, and long stretches both share folded to a count that opens.
 */
export function TextDiffView({ parts, addedLabel, removedLabel, truncated }: TextDiffViewProps) {
	const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
	const segments = useMemo(() => diffSegments(parts, open), [parts, open]);

	return (
		<section
			aria-label="What differs"
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]"
		>
			<div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--line)] px-4 py-2.5 text-sm text-[var(--ink-muted)]">
				<span className="flex items-center gap-1.5">
					<span aria-hidden className="h-3 w-3 rounded-[var(--radius-sm)] bg-[var(--ok-soft)] ring-1 ring-[var(--ok)]/40 ring-inset" />
					Only in {addedLabel}
				</span>
				<span className="flex items-center gap-1.5">
					<span aria-hidden className="h-3 w-3 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] ring-1 ring-[var(--risk)]/40 ring-inset" />
					Only in {removedLabel}
				</span>
				{truncated ? <span>Only the start of a long file was compared.</span> : null}
			</div>
			<div data-selectable className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-document whitespace-pre-wrap">
				{segments.map((segment, at) => {
					const gap = at > 0 ? " " : "";
					if (segment.kind === "hidden") {
						return (
							<span key={`h${segment.index}`}>
								{gap}
								<button
									type="button"
									onClick={() => setOpen((current) => new Set(current).add(segment.index))}
									className="mx-0.5 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 align-baseline text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
								>
									{segment.words} words the same
								</button>
							</span>
						);
					}
					if (segment.kind === "same") return <span key={at}>{gap + segment.text}</span>;
					return (
						<span key={at}>
							{gap}
							{segment.kind === "added" ? (
								<ins className="rounded-[var(--radius-sm)] bg-[var(--ok-soft)] px-0.5 text-[var(--ink)] no-underline">
									<span className="sr-only">Added: </span>
									{segment.text}
								</ins>
							) : (
								<del className="rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-0.5 text-[var(--ink-muted)] decoration-[var(--risk)]">
									<span className="sr-only">Removed: </span>
									{segment.text}
								</del>
							)}
						</span>
					);
				})}
			</div>
		</section>
	);
}
