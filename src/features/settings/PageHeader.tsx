import { groupById, pagesOf, type SettingsPage } from "./pages";

type PageHeaderProps = {
	page: SettingsPage;
};

/**
 * The title of a page, and under which group it lives.
 *
 * The group is only named when it has other pages: "Documents" above
 * "Statuses and labels" says where you are, and "Mail accounts" above "Mail
 * accounts" says nothing.
 */
export function PageHeader({ page }: PageHeaderProps) {
	const group = groupById(page.group);
	const showGroup = pagesOf(page.group).length > 1;

	return (
		<header className="mb-4">
			{showGroup ? (
				<p className="mb-0.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{group.label}</p>
			) : null}
			<h1 className="text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">{page.label}</h1>
		</header>
	);
}
