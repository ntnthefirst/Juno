import type { ReactNode } from "react";

/**
 * A settings section is a heading and space, not a card. See brand/BRAND.md
 * section 7: a stack of bordered panels is exactly the reflex this project is
 * avoiding.
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
		<section className="mt-12 first:mt-0">
			<div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-2">
				<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">{title}</h2>
				{action}
			</div>
			{description ? (
				<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{description}
				</p>
			) : null}
			<div className="mt-4">{children}</div>
		</section>
	);
}

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
