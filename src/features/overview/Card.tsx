import type { ReactNode } from "react";
import type { Loaded } from "../../lib/use-loaded";

type CardProps = {
	title: string;
	/** Drawn beside the title, muted. Left out when a count would only say "0". */
	count?: number;
	/** Whatever sits at the right of the title: a link to the full screen, an add button. */
	action?: ReactNode;
	children: ReactNode;
};

/**
 * One block of the overview. A hairline and the surface colour set it apart
 * from the page, and the rows inside carry no borders of their own: grouping
 * is done by space and by the small labels, which keeps a card with eight rows
 * from reading as a table.
 */
export function Card({ title, count, action, children }: CardProps) {
	return (
		<section className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] pb-2">
			<header className="flex min-h-[44px] items-center gap-2 px-4 pt-1">
				<h2 className="text-[length:var(--text-base)] font-[var(--weight-semibold)]">{title}</h2>
				{count !== undefined && count > 0 ? (
					<span className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">{count}</span>
				) : null}
				<span className="ml-auto flex items-center gap-1">{action}</span>
			</header>
			<div className="px-2">{children}</div>
		</section>
	);
}

type GroupLabelProps = {
	children: string;
};

/** The small label that splits a card by time: Today, Yesterday, Last 7 days. */
export function GroupLabel({ children }: GroupLabelProps) {
	return (
		<p className="px-2 pt-3 pb-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)] first:pt-1">
			{children}
		</p>
	);
}

type CardNoteProps = {
	children: ReactNode;
};

/** A line standing in for rows: loading, nothing to show, or why it could not load. */
export function CardNote({ children }: CardNoteProps) {
	return <p className="px-2 py-6 text-center text-[length:var(--text-dense)] text-[var(--ink-muted)]">{children}</p>;
}

type CardErrorProps = {
	what: string;
	state: Loaded<unknown>;
};

/** The failure of one card, said in the card, so the rest of the page still works. */
export function CardError({ what, state }: CardErrorProps) {
	if (state.status !== "error") return null;
	return (
		<div className="mx-2 my-3 border-l-2 border-[var(--risk)] pl-3">
			<p className="text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--risk)]">
				Could not load {what}.
			</p>
			<p data-selectable className="mt-0.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{state.message}
			</p>
		</div>
	);
}

type CardLinkProps = {
	label: string;
	onClick: () => void;
};

/** The quiet text at the top right of a card that opens the whole list. */
export function CardLink({ label, onClick }: CardLinkProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="h-8 rounded-[var(--radius-md)] px-2 text-[length:var(--text-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--accent)]"
		>
			{label}
		</button>
	);
}
