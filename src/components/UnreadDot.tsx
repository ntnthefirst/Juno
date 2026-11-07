type UnreadDotProps = {
	/** Placement is the caller's: the dot itself is only a size and a colour. */
	className?: string;
};

/** The 8px iris dot that marks something unread (Unread Dot in the design file). */
export function UnreadDot({ className = "" }: UnreadDotProps) {
	return <span aria-hidden className={`inline-block h-2 w-2 flex-none rounded-[var(--radius-full)] bg-[var(--accent)] ${className}`} />;
}
