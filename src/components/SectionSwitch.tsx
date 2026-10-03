import type { ScreenId, ScreenSwitch } from "../app/screens";
import { requestOpen } from "../lib/open-entity";

type SectionSwitchProps = {
	sections: ScreenSwitch;
	/** The screen on show, which is one of the two sides. */
	current: ScreenId;
	/** Names the pair for a screen reader. "Mail views". */
	label: string;
};

/**
 * Two screens that share a page, drawn as one small control: the side you are
 * on is raised, the other is a word. It replaces a second sidebar entry, so the
 * rail stays at the places the work happens and the other half of a pair is one
 * press away from the top of its own page.
 *
 * The press goes through the shell, which remounts the target, so each side
 * opens on its list and not on whatever it was last showing.
 */
export function SectionSwitch({ sections, current, label }: SectionSwitchProps) {
	return (
		<nav
			aria-label={label}
			data-section-switch
			className="inline-flex flex-none items-center gap-0.5 rounded-[var(--radius-lg)] bg-[var(--sunken)] p-0.5"
		>
			{[sections.left, sections.right].map((side) => {
				const active = side.id === current;
				return (
					<button
						key={side.id}
						type="button"
						aria-current={active ? "page" : undefined}
						onClick={() => {
							if (!active) requestOpen({ kind: "screen", screen: side.id });
						}}
						className={[
							"h-8 whitespace-nowrap rounded-[calc(var(--radius-lg)-2px)] border px-3 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
							active
								? "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
								: "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						{side.label}
					</button>
				);
			})}
		</nav>
	);
}
