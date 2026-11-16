import { SkeletonBar } from "./SkeletonBar";

/**
 * The shape of a page while the file it stands for is read, so nothing jumps
 * when it arrives: the same sunken ground and a sheet of A4 proportions where
 * the first page will be, with lines where its text will be.
 */
export function PreviewSkeleton() {
	return (
		<div role="status" aria-label="Loading the preview" aria-busy="true" className="flex h-full justify-center overflow-hidden bg-[var(--sunken)] p-6">
			<div className="flex aspect-[210/297] h-fit w-full max-w-[640px] flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-10">
				<SkeletonBar width="40%" size="h2" />
				<span className="h-4" />
				<SkeletonBar width="100%" size="sm" />
				<SkeletonBar width="92%" size="sm" />
				<SkeletonBar width="100%" size="sm" />
				<SkeletonBar width="74%" size="sm" />
				<span className="h-4" />
				<SkeletonBar width="100%" size="sm" />
				<SkeletonBar width="84%" size="sm" />
			</div>
		</div>
	);
}
