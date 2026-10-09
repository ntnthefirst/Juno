import { useEffect, useState } from "react";
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
 * Where the raised side was the last time this pair was drawn, by pair. Each
 * side is its own screen, so each press draws a fresh copy of this control.
 * Starting the new copy where the old one ended, and moving it on the next
 * frame, is what lets the raised side slide across instead of jumping.
 */
const lastSide = new Map<string, ScreenId>();

/**
 * Two screens that share a page, drawn as one small control: the side you are
 * on is raised, the other is a word. It replaces a second sidebar entry, so the
 * rail stays at the places the work happens and the other half of a pair is one
 * press away from the top of its own page.
 *
 * The press goes through the shell, which remounts the target, so each side
 * opens on its list and not on whatever it was last showing. The sides are the
 * same width so the raised side can be moved by half the control and no
 * measuring.
 */
export function SectionSwitch({ sections, current, label }: SectionSwitchProps) {
	const pair = sections.left.id;
	const [drawn, setDrawn] = useState<ScreenId>(() => lastSide.get(pair) ?? current);

	useEffect(() => {
		lastSide.set(pair, current);
		const frame = requestAnimationFrame(() => setDrawn(current));
		return () => cancelAnimationFrame(frame);
	}, [pair, current]);

	const onRight = drawn === sections.right.id;

	return (
		<nav
			aria-label={label}
			data-section-switch
			className="relative inline-grid flex-none grid-cols-2 rounded-[var(--radius-lg)] bg-[var(--sunken)] p-0.5"
		>
			<span
				aria-hidden
				className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[calc(var(--radius-lg)-2px)] border border-[var(--line)] bg-[var(--surface)] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-smooth)]"
				style={{ transform: onRight ? "translateX(100%)" : "translateX(0)" }}
			/>
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
							"relative z-10 h-8 whitespace-nowrap px-4 text-[length:var(--text-dense)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-base)] ease-[var(--ease)]",
							active ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						{side.label}
					</button>
				);
			})}
		</nav>
	);
}
