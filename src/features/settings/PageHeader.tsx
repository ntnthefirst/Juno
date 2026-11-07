import type { ReactNode } from "react";
import { groupById, pagesOf, type SettingsPage } from "./pages";

type PageHeaderProps = {
	page: SettingsPage;
	/** A button for the page as a whole, drawn at the right of the title. */
	action?: ReactNode;
};

/**
 * The title of a page, and under which group it lives.
 *
 * A group with several pages is named above the title ("Documents" over
 * "Statuses and labels"). A group that is one page has nothing to say about
 * where you are, so the line above it names the window, as the frames draw it.
 */
export function PageHeader({ page, action }: PageHeaderProps) {
	const group = groupById(page.group);
	const crumb = pagesOf(page.group).length > 1 ? group.label : "Settings";

	return (
		<header className="mb-1.5 flex items-start justify-between gap-4">
			<div>
				<p className="mb-0.5 text-sm text-[var(--ink-muted)]">{crumb}</p>
				<h1 className="text-h2">{page.label}</h1>
			</div>
			{action ? <div className="flex-none pt-2">{action}</div> : null}
		</header>
	);
}
