import { SkeletonBar } from "./SkeletonBar";

type CardSkeletonProps = {
	/** Lines of text under the heading. */
	lines?: number;
	/** Drawn with the card's border and padding, or bare inside a card that is already there. */
	framed?: boolean;
	/** What is loading, for a screen reader. */
	label?: string;
};

const WIDTHS = ["86%", "72%", "64%", "78%", "58%", "69%"];

/**
 * A card still on its way: a heading and a few lines, in the card's own frame
 * (`--radius-lg`, a hairline border), so the card does not grow under what
 * is below it when its content lands. Bare, it fills a section whose heading
 * and frame are already drawn.
 */
export function CardSkeleton({ lines = 3, framed = true, label = "Loading" }: CardSkeletonProps) {
	return (
		<div
			role="status"
			aria-label={label}
			aria-busy="true"
			className={framed ? "rounded-[var(--radius-lg)] border border-[var(--line)] p-5" : ""}
		>
			{framed ? (
				<div className="mb-3">
					<SkeletonBar width="28%" />
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				{Array.from({ length: lines }, (_, index) => (
					<SkeletonBar key={index} width={WIDTHS[index % WIDTHS.length]} size="sm" />
				))}
			</div>
		</div>
	);
}
