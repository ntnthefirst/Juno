import { useEffect, type ReactNode } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

export type FormStep = {
	/** Shown in the rail. Two words at most: it is a label, not a sentence. */
	label: string;
	/** One line under the title while this step is the current one. */
	hint?: string;
};

type FormPageProps = {
	title: string;
	/** Where back goes. Escape does the same thing. */
	onBack: () => void;
	/** Wording for the back control, when "Back" is not what it does. */
	backLabel?: string;
	description?: ReactNode;
	/** Omit for a form that is one page. Two or more turns it into a sequence. */
	steps?: FormStep[];
	/** Zero-based, and only read when `steps` is given. */
	step?: number;
	/** Jump to an earlier step. Later ones are not offered: they are not filled in yet. */
	onStep?: (index: number) => void;
	/**
	 * "form" is a reading measure for a column of fields, because a text input
	 * stretched across a wide window is unpleasant to fill in and hard to scan.
	 * "wide" is for a form that carries a table, a preview or two panes.
	 */
	width?: "form" | "wide";
	/** The buttons, right-aligned at the bottom. */
	actions?: ReactNode;
	children: ReactNode;
};

/**
 * A form that takes over the screen rather than floating above it.
 *
 * A modal is the right shape for a question with two answers. It is the wrong
 * shape for filling something in: it is narrower than the screen it covers, it
 * traps focus away from the record being described, and it cannot show a
 * sequence without growing a scrollbar inside a scrollbar. So anything with
 * fields in it replaces the content and offers a way back, and the modal is
 * kept for confirmations.
 *
 * It fills whatever it is rendered into, so a screen renders this *instead of*
 * its list rather than on top of it, and the settings window renders it in
 * place of a section.
 */
export function FormPage({
	title,
	onBack,
	backLabel = "Back",
	description,
	steps,
	step = 0,
	onStep,
	width = "form",
	actions,
	children,
}: FormPageProps) {
	const measure = width === "wide" ? "max-w-[var(--content-width)]" : "max-w-[620px]";
	// Escape leaves, the same as the back control. A form page is not modal, so
	// this is a convenience rather than the only way out.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Not while a select is open or a confirmation is over the top of this.
			if (document.querySelector("[role='dialog']")) return;
			onBack();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onBack]);

	const sequence = steps && steps.length > 1;
	const current = sequence ? steps[Math.min(step, steps.length - 1)] : undefined;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-none items-center gap-2 border-b border-[var(--line)] px-6 py-3">
				<button
					type="button"
					onClick={onBack}
					className="-ml-2 inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<ArrowLeftIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
					{backLabel}
				</button>
				<span className="flex-none text-[var(--ink-faint)]" aria-hidden>
					/
				</span>
				<h1 className="min-w-0 truncate text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]">
					{title}
				</h1>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className={`mx-auto w-full ${measure}`}>
					{sequence ? <StepRail steps={steps} step={step} onStep={onStep} /> : null}

					{current?.hint ? (
						<p className="mb-5 max-w-[62ch] text-[var(--ink-muted)]">{current.hint}</p>
					) : null}
					{description ? (
						<div className="mb-5 max-w-[62ch] text-[var(--ink-muted)]">{description}</div>
					) : null}

					{children}
				</div>
			</div>

			{actions ? (
				<div className="flex-none border-t border-[var(--line)] px-6 py-3">
					<div className={`mx-auto flex w-full ${measure} items-center justify-end gap-2`}>
						{actions}
					</div>
				</div>
			) : null}
		</div>
	);
}

type StepRailProps = {
	steps: FormStep[];
	step: number;
	onStep?: (index: number) => void;
};

/**
 * Where you are in the sequence, and how much is left. Steps already passed are
 * clickable, because going back to change an answer is normal. Steps ahead are
 * not: they are not filled in yet, and offering them would suggest they are.
 */
function StepRail({ steps, step, onStep }: StepRailProps) {
	return (
		<ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1">
			{steps.map((entry, index) => {
				const state = index === step ? "current" : index < step ? "done" : "ahead";
				const reachable = state === "done" && onStep !== undefined;
				return (
					<li key={entry.label} className="flex items-center gap-2">
						{index > 0 ? (
							<span aria-hidden className="h-px w-6 bg-[var(--line-strong)]" />
						) : null}
						<button
							type="button"
							disabled={!reachable}
							aria-current={state === "current" ? "step" : undefined}
							onClick={reachable ? () => onStep(index) : undefined}
							className={[
								"flex h-[28px] items-center gap-2 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
								state === "current"
									? "font-[var(--weight-medium)] text-[var(--ink)]"
									: "text-[var(--ink-muted)]",
								reachable ? "hover:bg-[var(--hover)] hover:text-[var(--ink)]" : "",
							].join(" ")}
						>
							<span
								aria-hidden
								className={[
									"tabular flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full text-[length:var(--text-micro)] font-[var(--weight-medium)]",
									state === "ahead"
										? "border border-[var(--line-strong)] text-[var(--ink-faint)]"
										: "bg-[var(--accent)] text-[var(--accent-ink)]",
								].join(" ")}
							>
								{index + 1}
							</span>
							{entry.label}
						</button>
					</li>
				);
			})}
		</ol>
	);
}
