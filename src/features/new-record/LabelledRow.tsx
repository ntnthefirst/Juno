import type { ReactNode } from "react";

type LabelledRowProps = {
	/** The words in the 72px column at the left. Left out, the column stays empty. */
	label?: string;
	/** The control the words name, so a click on them reaches it. */
	htmlFor?: string;
	children: ReactNode;
};

/**
 * One row of the new event window: a small muted label in a 72px column, then
 * the controls, 12px apart (frame 175:12676). The label sits level with the
 * first line of a 36px control, so a taller control below it does not pull it
 * down to its middle.
 */
export function LabelledRow({ label, htmlFor, children }: LabelledRowProps) {
	return (
		<div className="flex items-start gap-3">
			<div className="flex h-9 w-18 flex-none items-center">
				{label ? (
					<label htmlFor={htmlFor} className="text-sm text-[var(--ink-muted)]">
						{label}
					</label>
				) : null}
			</div>
			<div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
		</div>
	);
}
