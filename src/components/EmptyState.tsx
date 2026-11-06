import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";
import { Kbd } from "./Kbd";

type Action = {
	label: string;
	icon?: IconName;
	onClick: () => void;
	shortcut?: string[];
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
	tip?: ReactNode;
};

/**
 * An empty state for a list, screen or section.
 *
 * Sits in the sheet with room around it, a clear explanation of what
 * the entity is and why it exists, and an immediate primary action with its
 * keyboard shortcut.
 */
export function EmptyState({
	icon,
	title,
	description,
	action,
	secondaryAction,
	tip,
}: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade">
			{icon ? (
				<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--sunken)] text-[var(--ink-muted)]">
					<Icon name={icon} size={24} />
				</div>
			) : null}

			<h3 className="text-lg font-[var(--weight-medium)] text-[var(--ink)]">
				{title}
			</h3>

			<p className="mt-3 max-w-[44ch] text-base text-[var(--ink-muted)]">
				{description}
			</p>

			{action || secondaryAction ? (
				<div className="mt-3 flex flex-wrap items-center justify-center gap-3">
					{action ? (
						<div className="flex items-center gap-2">
							<Button variant="primary" onClick={action.onClick}>
								{action.icon ? <Icon name={action.icon} size={16} /> : null}
								{action.label}
							</Button>
							{action.shortcut ? (
								<span className="hidden sm:inline-flex">
									<Kbd keys={action.shortcut} />
								</span>
							) : null}
						</div>
					) : null}

					{secondaryAction ? (
						<Button variant="quiet" onClick={secondaryAction.onClick}>
							{secondaryAction.label}
						</Button>
					) : null}
				</div>
			) : null}

			{tip ? (
				<div className="mt-8 text-sm text-[var(--ink-faint)]">
					{tip}
				</div>
			) : null}
		</div>
	);
}
