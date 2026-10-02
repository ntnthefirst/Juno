import type { AgentEntityRef } from "@shared/types";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { isOpenable, KIND_ICONS, openEntity } from "./entity-links";

type EntityChipProps = {
	entity: AgentEntityRef;
	/** small drops the second line and the role, for a row in a list. */
	compact?: boolean;
	onNotice: (message: string) => void;
};

/**
 * A record a request names, by what it is called, as something to press. It
 * says what the record is to the request ("Client", "Draft"), what it is
 * called, and one more line where there is one. A record that is gone says so
 * instead of showing an id nobody can read.
 */
export function EntityChip({ entity, compact = false, onNotice }: EntityChipProps) {
	const openable = isOpenable(entity);
	const label = entity.label ?? "No longer here";

	const body = (
		<>
			<span
				className={`flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${
					entity.gone ? "bg-[var(--sunken)] text-[var(--ink-faint)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"
				}`}
			>
				<Icon name={KIND_ICONS[entity.kind]} size={14} />
			</span>
			<span className="flex min-w-0 flex-col text-left leading-tight">
				{compact ? null : (
					<span className="text-[length:var(--text-micro)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
						{entity.role}
					</span>
				)}
				<span
					className={`truncate text-[length:var(--text-dense)] ${entity.gone ? "text-[var(--ink-muted)] line-through" : "font-[var(--weight-medium)]"}`}
				>
					{label}
				</span>
				{!compact && entity.detail ? (
					<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">{entity.detail}</span>
				) : null}
			</span>
			{openable ? <Icon name="external" size={12} className="shrink-0 text-[var(--ink-faint)]" /> : null}
		</>
	);

	const shape =
		"inline-flex max-w-[280px] min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--paper)] py-1 pl-1 pr-2";

	if (!openable) {
		return (
			<span className={shape} title={entity.gone ? "This record was deleted" : undefined}>
				{body}
			</span>
		);
	}
	return (
		<button
			type="button"
			title={`Open ${label}`}
			onClick={() => void openEntity(entity).catch((cause: unknown) => onNotice(messageOf(cause)))}
			className={`${shape} transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
		>
			{body}
		</button>
	);
}
