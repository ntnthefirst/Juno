import { CardSkeleton } from "./CardSkeleton";
import { SkeletonBar } from "./SkeletonBar";

type RecordSkeletonProps = {
	/** People are round and businesses and projects are square, as `Avatar` draws them. */
	shape?: "round" | "square";
	/** What is loading, for a screen reader. */
	label?: string;
};

/**
 * A record still on its way: the header card with its avatar, name and the
 * line under it, the tabs, and two cards below, at the sizes a client or a
 * project draws them, so the page does not reflow when the record lands.
 */
export function RecordSkeleton({ shape = "round", label = "Loading" }: RecordSkeletonProps) {
	return (
		<div role="status" aria-label={label} aria-busy="true" className="flex flex-col gap-5">
			<div className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--line)] p-6">
				<span
					aria-hidden
					className={`h-[59px] w-[59px] flex-none animate-skeleton bg-ink/8 ${
						shape === "round" ? "rounded-[var(--radius-full)]" : "rounded-[var(--radius-lg)]"
					}`}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<SkeletonBar width="34%" size="h2" />
					<SkeletonBar width="22%" />
				</div>
			</div>
			<div className="flex h-9 items-center gap-6 border-b border-[var(--line)]">
				{["8%", "7%", "6%", "8%"].map((width, index) => (
					<SkeletonBar key={index} width={width} size="sm" />
				))}
			</div>
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
				<CardSkeleton lines={5} />
				<CardSkeleton lines={4} />
			</div>
		</div>
	);
}
