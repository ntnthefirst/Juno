import { SkeletonBar } from "./SkeletonBar";

type RowsSkeletonProps = {
	/** How many rows to draw: about as many as usually arrive, so the list does not jump. */
	rows?: number;
	/** Rows that carry an avatar are the roomy height and start with a circle. */
	avatar?: boolean;
	/** A rule under each row, as a list or a table draws it. Off inside a menu. */
	divided?: boolean;
	/** A short column at the right of each row, where a date or a count sits. */
	trailing?: boolean;
	/** What is loading, for a screen reader. */
	label?: string;
};

/** Widths that vary the way names do, so the rows read as a list and not a grid. */
const WIDTHS = ["62%", "48%", "71%", "55%", "40%", "66%", "52%", "44%"];

/**
 * A list still on its way, drawn as rows at the height the real rows have
 * (`--row-height`, or `--row-height-roomy` with an avatar), so nothing under
 * the list moves when they arrive.
 */
export function RowsSkeleton({ rows = 5, avatar = false, divided = true, trailing = true, label = "Loading" }: RowsSkeletonProps) {
	return (
		<div role="status" aria-label={label} aria-busy="true" className="flex flex-col">
			{Array.from({ length: rows }, (_, index) => (
				<div
					key={index}
					className={`flex items-center gap-3 px-2 ${divided ? "border-b border-[var(--line)]" : ""}`}
					style={{ height: avatar ? "var(--row-height-roomy)" : "var(--row-height)" }}
				>
					{avatar ? (
						<span
							aria-hidden
							className="h-7 w-7 flex-none animate-skeleton rounded-[var(--radius-full)] bg-ink/8"
						/>
					) : null}
					<span className="min-w-0 flex-1">
						<SkeletonBar width={WIDTHS[index % WIDTHS.length]} size="sm" />
					</span>
					{trailing ? (
						<span className="w-[12%] min-w-10 flex-none">
							<SkeletonBar size="sm" />
						</span>
					) : null}
				</div>
			))}
		</div>
	);
}
