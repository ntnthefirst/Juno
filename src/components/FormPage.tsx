import { useEffect, type ReactNode } from "react";
import { CheckIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";

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
	const measure = width === "wide" ? "max-w-none" : "max-w-[620px]";
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
			<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-6">
				<div className={`animate-rise mx-auto w-full ${measure}`}>
					<header className="mb-4 flex flex-col items-start gap-2">
						<button
							type="button"
							onClick={onBack}
							className="-ml-1 inline-flex min-h-[32px] items-center gap-1 rounded-[var(--radius-md)] px-1 text-base text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-[var(--ink)]"
						>
							<ChevronLeftIcon width={14} height={14} strokeWidth={2} aria-hidden />
							{backLabel}
						</button>
						<h1 className="min-w-0 text-h2">{title}</h1>
						{description ? <div className="max-w-[62ch] text-base text-[var(--ink-muted)]">{description}</div> : null}
					</header>

					{sequence ? <StepRail steps={steps} step={step} onStep={onStep} /> : null}

					{current?.hint ? (
						<p className="mb-5 max-w-[62ch] text-[var(--ink-muted)]">{current.hint}</p>
					) : null}

					{children}
				</div>
			</div>

			{actions ? (
				<div className="flex-none px-6">
					<div className={`mx-auto flex w-full ${measure} items-center justify-end gap-2 border-t border-[var(--line)] py-4`}>
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
 * not drawn at all, as the design has it: they are not filled in yet.
 */
function StepRail({ steps, step, onStep }: StepRailProps) {
	return (
		<ol className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
			{steps.slice(0, step + 1).map((entry, index) => {
				const current = index === step;
				const reachable = !current && onStep !== undefined;
				return (
					<li key={entry.label}>
						<button
							type="button"
							disabled={!reachable}
							aria-current={current ? "step" : undefined}
							onClick={reachable ? () => onStep(index) : undefined}
							className={[
								"flex items-center gap-3 py-2 text-base font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
								current ? "text-[var(--ink)]" : "text-[var(--ink-muted)]",
								reachable ? "hover:text-[var(--ink)]" : "",
							].join(" ")}
						>
							<span
								aria-hidden
								className={[
									"tabular flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm font-[var(--weight-medium)]",
									current ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--ok-soft)] text-[var(--ok)]",
								].join(" ")}
							>
								{current ? index + 1 : <CheckIcon width={14} height={14} strokeWidth={2.2} />}
							</span>
							{entry.label}
						</button>
					</li>
				);
			})}
		</ol>
	);
}
