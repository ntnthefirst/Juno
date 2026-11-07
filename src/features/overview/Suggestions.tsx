import { useState } from "react";
import type { ReminderSuggestion } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { formatDate } from "../reminders/format";

type SuggestionsProps = {
	suggestions: ReminderSuggestion[];
	/** Re-read both the suggestions and the reminders they became. */
	onAccepted: () => void;
};

/**
 * Offers worked out from the records. Nothing here is stored until you add it,
 * and none of them is an invoice: Juno does not raise one (decision 9).
 */
export function Suggestions({ suggestions, onAccepted }: SuggestionsProps) {
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function accept(suggestion: ReminderSuggestion) {
		if (busyKey !== null) return;
		setBusyKey(suggestion.key);
		setError(null);
		try {
			await window.juno.reminders.accept(suggestion);
			onAccepted();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusyKey(null);
		}
	}

	return (
		<section>
			<div className="flex items-baseline gap-2">
				<h2 className="text-base font-[var(--weight-semibold)]">Suggestions</h2>
				<p className="text-sm text-ink-muted">Worked out from your records. Nothing is saved until you add it.</p>
			</div>
			{suggestions.map((suggestion) => (
				<div key={suggestion.key} className="flex items-center gap-4 py-2">
					<div className="min-w-0 flex-1">
						<p className="truncate text-base">{suggestion.title}</p>
						{suggestion.notes ? <p className="truncate text-sm text-ink-muted">{suggestion.notes}</p> : null}
					</div>
					<span className="flex-none whitespace-nowrap text-dense tabular-nums text-ink-muted">
						{formatDate(suggestion.dueOn)}
					</span>
					<button
						type="button"
						aria-label={`Add a reminder: ${suggestion.title}`}
						disabled={busyKey !== null}
						onClick={() => void accept(suggestion)}
						className="h-8 flex-none rounded-[var(--radius-md)] px-1 text-base font-[var(--weight-medium)] text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50"
					>
						Add
					</button>
				</div>
			))}
			{error ? (
				<p role="alert" data-selectable className="mt-3 border-l-2 border-risk pl-3 text-sm text-risk">
					{error}
				</p>
			) : null}
		</section>
	);
}
