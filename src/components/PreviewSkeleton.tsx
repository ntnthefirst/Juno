/**
 * The shape of a page while the file it stands for is read, so nothing jumps
 * when it arrives: the same sunken ground and a sheet of A4 proportions where
 * the first page will be.
 */
export function PreviewSkeleton() {
	return (
		<div aria-hidden className="flex h-full justify-center overflow-hidden bg-[var(--sunken)] p-6">
			<div className="flex aspect-[210/297] h-fit w-full max-w-[640px] animate-pulse flex-col gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-10">
				<span className="h-3 w-2/5 rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
				<span className="mt-4 h-2 w-full rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
				<span className="h-2 w-11/12 rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
				<span className="h-2 w-full rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
				<span className="h-2 w-3/4 rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
				<span className="mt-4 h-2 w-full rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
				<span className="h-2 w-5/6 rounded-[var(--radius-sm)] bg-[var(--sunken)]" />
			</div>
		</div>
	);
}
