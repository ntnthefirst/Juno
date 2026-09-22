import type { Briefing, BriefingItem, BriefingSection } from "@shared/types";
import { formatDate } from "../reminders/format";

type BriefingPanelProps = {
	briefing: Briefing | null;
	error: string | null;
	/** Which sections to draw. The rest of the screen owns the others. */
	sectionKeys: string[];
};

/**
 * The same answer an agent gets, on the screen.
 *
 * It is drawn from `briefing.today`, not assembled here, so what the window
 * shows and what an agent is told cannot drift apart. That is the whole point
 * of phase 6 and the reason this panel holds no queries of its own.
 */
export function BriefingPanel({ briefing, error, sectionKeys }: BriefingPanelProps) {
	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not work out the day.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (!briefing) return <p className="text-[var(--ink-muted)]">Working out the day.</p>;

	const shown = sectionKeys
		.map((key) => briefing.sections.find((section) => section.key === key))
		.filter((section): section is BriefingSection => Boolean(section));

	return (
		<div>
			<p className="max-w-[68ch] text-[length:var(--text-lg)] leading-[var(--leading-normal)]">
				{briefing.headline}
			</p>

			<div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
				{shown.map((section) => (
					<section key={section.key}>
						<h3 className="border-b border-[var(--line)] pb-1.5 text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
							{section.title}
						</h3>
						{section.items.length === 0 ? (
							<p className="mt-2 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
								{section.emptyText}
							</p>
						) : (
							<ul className="mt-2">
								{section.items.slice(0, 6).map((item) => (
									<li key={`${item.kind}:${item.id}`} className="border-b border-[var(--line)] py-1.5">
										<Line item={item} />
									</li>
								))}
								{section.items.length > 6 ? (
									<li className="tabular pt-1.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{section.items.length - 6} more
									</li>
								) : null}
							</ul>
						)}
					</section>
				))}
			</div>
		</div>
	);
}

function Line({ item }: { item: BriefingItem }) {
	return (
		<div className="flex items-baseline gap-2">
			<span
				className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-[var(--radius-full)] ${
					item.urgent ? "bg-[var(--risk)]" : "bg-[var(--accent)]"
				}`}
				aria-hidden
			/>
			<div className="min-w-0">
				<p className="truncate text-[length:var(--text-dense)]">{item.title}</p>
				{item.detail || item.on ? (
					<p className="tabular truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{[item.on ? formatDate(item.on) : null, item.detail].filter(Boolean).join(" · ")}
					</p>
				) : null}
			</div>
		</div>
	);
}
