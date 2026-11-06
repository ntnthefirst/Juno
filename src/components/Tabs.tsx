import { CountBadge } from "./CountBadge";
import { Icon, type IconName } from "./Icon";

export type TabItem<Id extends string> = {
	id: Id;
	label: string;
	icon?: IconName;
	/** Drawn as a pill after the label. Null or left out draws nothing. */
	count?: number | null;
	countTone?: "warn" | "accent" | "quiet";
};

type TabsProps<Id extends string> = {
	tabs: TabItem<Id>[];
	value: Id;
	onChange: (id: Id) => void;
	/** Names the group for a screen reader. */
	label: string;
};

/**
 * Underlined tabs with an optional icon and count: soft at rest, firm under
 * the pointer, iris with a two pixel line when it is the one in view.
 */
export function Tabs<Id extends string>({ tabs, value, onChange, label }: TabsProps<Id>) {
	return (
		<div role="tablist" aria-label={label} className="flex items-center border-b border-[var(--line)]">
			{tabs.map((entry) => {
				const active = entry.id === value;
				return (
					<button
						key={entry.id}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(entry.id)}
						className={[
							"-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-base font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
							active
								? "border-[var(--accent)] text-[var(--accent)]"
								: "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						{entry.icon ? <Icon name={entry.icon} size={16} /> : null}
						{entry.label}
						{entry.count !== undefined && entry.count !== null ? (
							<CountBadge count={entry.count} tone={entry.countTone ?? "warn"} />
						) : null}
					</button>
				);
			})}
		</div>
	);
}
