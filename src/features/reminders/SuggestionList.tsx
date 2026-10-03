import { useState } from "react";
import type { ReminderSuggestion } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { formatDate } from "./format";

type SuggestionListProps = {
	suggestions: ReminderSuggestion[];
	/** Re-read both the suggestions and the reminders they became. */
	onAccepted: () => void;
};

/**
 * Offers, not commitments: lighter than a real reminder, and nothing here is
 * stored until you accept it. Dismissing is not offered on purpose, because a
 * suggestion comes back as long as the situation that produced it holds.
 */
export function SuggestionList({ suggestions, onAccepted }: SuggestionListProps) {
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
		<div>
			<p className="px-2 pb-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Worked out from your projects and documents. Nothing is saved until you add it.
			</p>

			{suggestions.map((suggestion) => (
				<div
					key={suggestion.key}
					className="group flex items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
				>
					<div className="min-w-0 flex-1">
						<p className="truncate text-[length:var(--text-base)]">{suggestion.title}</p>
						{suggestion.notes ? (
							<p className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{suggestion.notes}</p>
						) : null}
					</div>

					<span className="tabular shrink-0 whitespace-nowrap text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						{formatDate(suggestion.dueOn)}
					</span>

					<button
						type="button"
						aria-label={`Add a reminder: ${suggestion.title}`}
						disabled={busyKey !== null}
						onClick={() => void accept(suggestion)}
						className="h-8 shrink-0 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] font-[var(--weight-medium)] text-[var(--accent)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-50"
					>
						Add
					</button>
				</div>
			))}

			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}
		</div>
	);
}
