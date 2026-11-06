import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type SegmentedOption<Id extends string> = {
	id: Id;
	/** Text for a text option. Icon options leave it out and give `name`. */
	label?: ReactNode;
	icon?: IconName;
	/** The spoken name and tooltip, required when there is no text. */
	name?: string;
};

type SegmentedProps<Id extends string> = {
	options: SegmentedOption<Id>[];
	value: Id;
	onChange: (id: Id) => void;
	/** Names the group for a screen reader. */
	label: string;
	/**
	 * Base is the Segmented Control, compact the 28px one for the title bar and
	 * toolbars, icons the View Switch: 40 by 32px glyph options.
	 */
	size?: "base" | "compact" | "icons";
};

const FRAME = {
	base: "gap-1 rounded-[var(--radius-lg)] p-1",
	compact: "gap-0.5 rounded-[var(--radius-md)] p-0.5",
	icons: "gap-0.5 rounded-[var(--radius-lg)] p-1",
};

const OPTION = {
	base: "rounded-[var(--radius-md)] px-4 py-1.5 text-base",
	compact: "rounded-[var(--radius-sm)] px-2.5 py-[3px] text-dense",
	icons: "h-8 w-10 justify-center rounded-[var(--radius-md)]",
};

/**
 * Switches a view in place: a sunken track with the chosen side raised on the
 * surface colour. Every option is a button, and the group is named.
 */
export function Segmented<Id extends string>({ options, value, onChange, label, size = "base" }: SegmentedProps<Id>) {
	return (
		<div role="group" aria-label={label} className={`inline-flex shrink-0 items-center bg-[var(--sunken)] ${FRAME[size]}`}>
			{options.map((option) => {
				const active = option.id === value;
				return (
					<button
						key={option.id}
						type="button"
						aria-pressed={active}
						aria-label={option.name}
						title={option.name}
						onClick={() => onChange(option.id)}
						className={[
							"flex items-center whitespace-nowrap font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
							OPTION[size],
							active ? "bg-[var(--surface)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						{option.icon ? <Icon name={option.icon} size={16} /> : null}
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
