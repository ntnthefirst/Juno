import type { FilePreviewSource } from "@shared/types";
import { FilePreviewView } from "../../components/FilePreviewView";
import { useFilePreview } from "../../lib/use-file-preview";

type ComparePaneProps = {
	/** "Adding", "Already in Juno". */
	label: string;
	name: string;
	/** One line of what it is: type, size, date. */
	meta: string;
	source: FilePreviewSource | null;
	/** Drawn with the accent edge, for the side the answer acts on. */
	emphasis?: boolean;
};

/** One side of a comparison: what the file is called and what it looks like. */
export function ComparePane({ label, name, meta, source, emphasis = false }: ComparePaneProps) {
	const state = useFilePreview(source);
	return (
		<section
			aria-label={label}
			className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface)] ${
				emphasis ? "border-[var(--accent)]/50" : "border-[var(--line)]"
			}`}
		>
			<div className="flex-none border-b border-[var(--line)] px-4 py-2.5">
				<p className="text-overline text-[var(--ink-muted)] uppercase">{label}</p>
				<p data-selectable className="truncate text-base font-[var(--weight-medium)]" title={name}>
					{name}
				</p>
				<p className="tabular truncate text-sm text-[var(--ink-muted)]">{meta}</p>
			</div>
			<div className="min-h-0 flex-1">
				{source ? (
					<FilePreviewView state={state} />
				) : (
					<div className="flex h-full items-center justify-center bg-[var(--sunken)] p-6 text-sm text-[var(--ink-muted)]">
						That document has no file yet.
					</div>
				)}
			</div>
		</section>
	);
}
