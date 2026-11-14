type SkeletonBarProps = {
	/** How much of the line the text it stands in for would take: "60%", or a length. */
	width?: string;
	/** The text style it stands in for, which decides how tall the bar is. */
	size?: "micro" | "sm" | "base" | "h2";
};

/** Each bar is a little shorter than the line it sits on, the way a word is. */
const LINE: Record<NonNullable<SkeletonBarProps["size"]>, string> = {
	micro: "h-4",
	sm: "h-[18px]",
	base: "h-[21px]",
	h2: "h-[30px]",
};

const BAR: Record<NonNullable<SkeletonBarProps["size"]>, string> = {
	micro: "h-2",
	sm: "h-2.5",
	base: "h-3",
	h2: "h-5",
};

/**
 * One line of text that has not arrived yet. It takes the height of the line
 * it stands in for, so swapping it for the real text moves nothing below it.
 * The pulse is opacity only and stops under reduced motion (`global.css`).
 */
export function SkeletonBar({ width = "100%", size = "base" }: SkeletonBarProps) {
	return (
		<span aria-hidden className={`flex items-center ${LINE[size]}`} style={{ width }}>
			<span className={`block w-full animate-skeleton rounded-[var(--radius-sm)] bg-ink/8 ${BAR[size]}`} />
		</span>
	);
}
