import type { MouseEvent, ReactNode } from "react";

type RecordLinkProps = {
	/** The record's name as it reads. */
	children: ReactNode;
	onOpen: () => void;
	/**
	 * `accent` for a name that stands on its own, such as a value in a panel.
	 * `quiet` for one inside a muted line of meta, which keeps the line's own
	 * colour until the pointer is on it.
	 */
	tone?: "accent" | "quiet";
	/** What pressing it does, when the name alone does not say: "Open Acme". */
	label?: string;
	className?: string;
};

const TONES = {
	accent: "text-[var(--accent)] hover:text-[var(--accent-hover)]",
	quiet: "hover:text-[var(--ink)]",
};

/**
 * A record named inside a line of text, as something to press: a client in a
 * reminder's meta, the project in an event's panel. It opens the record the
 * way every other link to it does, and stops the click there, so a row that
 * opens something of its own does not open that as well.
 */
export function RecordLink({ children, onOpen, tone = "accent", label, className = "" }: RecordLinkProps) {
	function open(event: MouseEvent<HTMLButtonElement>) {
		event.stopPropagation();
		onOpen();
	}

	return (
		<button
			type="button"
			onClick={open}
			title={label}
			className={`inline-block max-w-full truncate rounded-[var(--radius-sm)] text-left align-bottom underline-offset-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${TONES[tone]} ${className}`}
		>
			{children}
		</button>
	);
}
