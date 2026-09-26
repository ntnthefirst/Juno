import type { ReactNode } from "react";

/**
 * A settings section is a heading and space, not a card. See brand/BRAND.md
 * section 7: a stack of bordered panels is exactly the reflex this project is
 * avoiding.
 *
 * The line between two sections runs above the next heading rather than under
 * each one, with room on both sides, so where one subject ends and the next
 * begins is plain even when a tab stacks three of them.
 */
export function Section({
	title,
	description,
	action,
	children,
}: {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={SECTION_GAP}>
			<div className="flex min-h-[32px] items-center justify-between gap-4">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">{title}</h2>
				{action}
			</div>
			{description ? (
				<p className="mt-1 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{description}
				</p>
			) : null}
			<div className="mt-5">{children}</div>
		</section>
	);
}

/**
 * The divider and the space around it. The agent connection panel draws its
 * own sections with the same classes, so change both together.
 */
const SECTION_GAP =
	"mt-10 border-t border-[var(--line-strong)] pt-8 first:mt-0 first:border-t-0 first:pt-0";

export function SectionError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p
			role="alert"
			data-selectable
			className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
		>
			{message}
		</p>
	);
}
