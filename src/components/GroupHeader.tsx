type GroupHeaderProps = {
	label: string;
	className?: string;
};

/**
 * The label above a day or a month in a list ordered by time (Group Header in
 * the design file): 32px tall, 12px medium and muted. Searches and lists
 * ordered by relevance have none.
 */
export function GroupHeader({ label, className = "" }: GroupHeaderProps) {
	return (
		<div className={`flex h-8 items-center px-2 text-sm font-[var(--weight-medium)] text-[var(--ink-muted)] ${className}`}>
			{label}
		</div>
	);
}
