import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";

type Action = {
	label: string;
	icon?: IconName;
	onClick: () => void;
};

type EmptyStateProps = {
	icon?: IconName;
	title: string;
	description: string;
	action?: Action;
	secondaryAction?: {
		label: string;
		onClick: () => void;
	};
};

/**
 * An empty state for a list, screen or section.
 *
 * Sits in the sheet with room around it, a clear explanation of what
 * the entity is and why it exists, and an immediate primary action.
 */
export function EmptyState({
	icon,
	title,
	description,
	action,
	secondaryAction,
}: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade">
			{icon ? (
				<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--sunken)] text-[var(--ink-muted)]">
					<Icon name={icon} size={24} />
				</div>
			) : null}

			<h3 className="text-base font-[var(--weight-medium)] text-[var(--ink)]">
				{title}
			</h3>

			<p className="mt-2 max-w-[44ch] text-sm text-[var(--ink-muted)]">
				{description}
			</p>

			{action || secondaryAction ? (
				<div className="mt-3 flex flex-wrap items-center justify-center gap-3">
					{action ? (
						<Button variant="primary" onClick={action.onClick}>
							{action.icon ? <Icon name={action.icon} size={16} /> : null}
							{action.label}
						</Button>
					) : null}

					{secondaryAction ? (
						<Button variant="quiet" onClick={secondaryAction.onClick}>
							{secondaryAction.label}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
