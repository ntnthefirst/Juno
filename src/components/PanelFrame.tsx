import type { ReactNode } from "react";
import type { FormStep } from "./FormPage";
import { Icon } from "./Icon";

type PanelFrameProps = {
	title: string;
	onBack: () => void;
	/** What back returns to, in two words. */
	backLabel: string;
	steps?: FormStep[];
	step?: number;
	/** Jump to an earlier step. Later ones are not offered: they are not filled in yet. */
	onStep?: (index: number) => void;
	actions?: ReactNode;
	children: ReactNode;
};

/**
 * A form drawn inside a docked pane rather than over the screen: a way back,
 * the title, the steps as a row of small labels, the fields one per row, and
 * the buttons along the foot. It is FormPage for a column a third of the width,
 * used where the owner wants a form beside the list it came from, such as
 * sending a styled mail while the mailbox stays in view.
 */
export function PanelFrame({ title, onBack, backLabel, steps, step = 0, onStep, actions, children }: PanelFrameProps) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex-none border-b border-[var(--line)] px-4 pt-3 pb-3">
				<button
					type="button"
					onClick={onBack}
					className="-ml-1.5 inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] pr-2 pl-1 text-[length:var(--text-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon name="chevron-left" size={14} strokeWidth={2} />
					{backLabel}
				</button>
				<h2 className="mt-1 truncate text-[length:var(--text-base)] font-[var(--weight-semibold)]">{title}</h2>
				{steps && steps.length > 1 ? (
					<ol className="mt-2 flex flex-wrap items-center gap-1" aria-label="Steps">
						{steps.map((entry, index) => {
							const current = index === step;
							const passed = index < step;
							return (
								<li key={entry.label} className="flex items-center gap-1">
									{index > 0 ? <span aria-hidden className="h-px w-3 bg-[var(--line-strong)]" /> : null}
									<button
										type="button"
										disabled={!passed || !onStep}
										onClick={() => onStep?.(index)}
										aria-current={current ? "step" : undefined}
										className={[
											"rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)]",
											current
												? "bg-[var(--accent-soft)] text-[var(--accent)]"
												: passed
													? "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
													: "text-[var(--ink-muted)] opacity-60",
										].join(" ")}
									>
										{index + 1}. {entry.label}
									</button>
								</li>
							);
						})}
					</ol>
				) : null}
				{steps?.[step]?.hint ? (
					<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{steps[step]?.hint}</p>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
			{actions ? (
				<div className="flex flex-none items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">{actions}</div>
			) : null}
		</div>
	);
}
