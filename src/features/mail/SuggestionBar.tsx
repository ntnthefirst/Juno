import type { MessageSuggestion } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";

type SuggestionBarProps = {
	suggestion: MessageSuggestion;
	/** The button that does it, named for what it does: "Add to calendar". */
	actionLabel: string;
	busy: boolean;
	onAccept: () => void;
	onDismiss: () => void;
};

const ICONS: Record<MessageSuggestion["kind"], IconName> = {
	event: "calendar",
	project: "projects",
	reminder: "reminders",
};

/**
 * One offer under a message header: what was noticed, the question, and two
 * buttons. Nothing is filed or created until the second one is pressed, and
 * Not now takes the offer away for this message for good.
 */
export function SuggestionBar({ suggestion, actionLabel, busy, onAccept, onDismiss }: SuggestionBarProps) {
	return (
		<div
			role="group"
			aria-label={suggestion.headline}
			className="flex h-14 shrink-0 items-center gap-3 rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-3 py-2.5"
		>
			<span className="flex size-7 flex-none items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--accent)]">
				<Icon name={ICONS[suggestion.kind]} size={16} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-base font-[var(--weight-medium)]">{suggestion.headline}</p>
				<p className="truncate text-sm text-[var(--ink-muted)]">{suggestion.question}</p>
			</div>
			<Button size="dense" disabled={busy} onClick={onDismiss}>
				Not now
			</Button>
			<Button size="dense" variant="primary" disabled={busy} onClick={onAccept}>
				{actionLabel}
			</Button>
		</div>
	);
}
