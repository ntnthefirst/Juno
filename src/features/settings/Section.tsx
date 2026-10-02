import { useContext, type ReactNode } from "react";
import { SoloSectionContext } from "./section-layout";

type SectionProps = {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	/** The name the settings search jumps to. Listed in search.ts and pages.ts. */
	anchor?: string;
	children: ReactNode;
};

/**
 * A settings section is a heading and space, not a card. See brand/BRAND.md
 * section 7: a stack of bordered panels is exactly the reflex this project is
 * avoiding.
 *
 * The line between two sections runs above the next heading rather than under
 * each one, with room on both sides, so where one subject ends and the next
 * begins is plain even when a page stacks two of them.
 *
 * On a page that holds only this section the heading is left out, because the
 * page's own title says it. What stays is the line that explains the section
 * and the button that acts on it, on one row.
 */
export function Section({ title, description, action, anchor, children }: SectionProps) {
	const solo = useContext(SoloSectionContext);

	if (solo) {
		return (
			<section data-setting={anchor}>
				{description || action ? (
					<div className="flex min-h-[32px] items-start justify-between gap-6">
						<p className="max-w-[62ch] text-[length:var(--text-dense)] text-[var(--ink-muted)]">
							{description}
						</p>
						{action ? <div className="flex-none">{action}</div> : null}
					</div>
				) : null}
				<div className={description || action ? "mt-6" : ""}>{children}</div>
			</section>
		);
	}

	return (
		<section data-setting={anchor} className={SECTION_GAP}>
			<div className="flex min-h-[32px] items-center justify-between gap-4">
				<h2 className="text-[length:var(--text-lg)] font-[var(--weight-semibold)]">{title}</h2>
				{action}
			</div>
			{description ? (
				<p className="mt-1 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{description}
				</p>
			) : null}
			<div className="mt-5">{children}</div>
		</section>
	);
}

/**
 * The divider and the space around it. The agent connection panel used to draw
 * its own sections with the same classes; it uses Section now.
 */
const SECTION_GAP =
	"mt-10 border-t border-[var(--line-strong)] pt-8 first:mt-0 first:border-t-0 first:pt-0";

export function SectionError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p
			role="alert"
			data-selectable
			className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
		>
			{message}
		</p>
	);
}
