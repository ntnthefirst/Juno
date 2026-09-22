import { useState } from "react";
import type { ReminderSuggestion } from "@shared/types";
import { Button } from "../../components/Button";
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
			<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Worked out from your projects and documents, not something you wrote down. Add one and it
				becomes a real reminder.
			</p>

			<div className="mt-3">
				{suggestions.map((suggestion) => (
					<div
						key={suggestion.key}
						className="flex items-center gap-3 border-b border-dashed border-[var(--line)] px-3 py-2"
					>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{suggestion.title}
							</p>
							{suggestion.notes ? (
								<p className="truncate text-[length:var(--text-sm)] text-[var(--ink-faint)]">
									{suggestion.notes}
								</p>
							) : null}
						</div>

						<span className="tabular shrink-0 whitespace-nowrap text-[length:var(--text-dense)] text-[var(--ink-faint)]">
							{formatDate(suggestion.dueOn)}
						</span>

						<Button
							size="dense"
							disabled={busyKey !== null}
							onClick={() => void accept(suggestion)}
						>
							Add reminder
						</Button>
					</div>
				))}
			</div>

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
