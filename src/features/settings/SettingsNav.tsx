import type { KeyboardEvent, RefObject } from "react";
import { Icon } from "../../components/Icon";
import { isMac } from "../../lib/platform";
import { firstPageOf, GROUPS, pageById, pagesOf, type SettingsPageId } from "./pages";

type SettingsNavProps = {
	/** The page being shown. The group that holds it is the one that unfolds. */
	page: SettingsPageId;
	onPage: (id: SettingsPageId) => void;
	query: string;
	onQuery: (query: string) => void;
	onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	searchRef: RefObject<HTMLInputElement | null>;
	/** The id of the result that Enter would open, for assistive technology. */
	activeResultId: string | undefined;
	resultsId: string;
};

/**
 * The left column: the search, and under it the six groups.
 *
 * The search sits above the sections rather than in the title bar because it is
 * how most people get anywhere in a window this size, and a box in the corner
 * of the title bar reads as decoration. What it finds is drawn as a page of its
 * own to the right (SearchResults), not as a drop-down under a 280px field.
 *
 * Only the group being shown unfolds its pages. All fourteen at once would not
 * fit above the fold, and a list that has to scroll to show where you are is
 * the thing this layout is here to get rid of.
 */
export function SettingsNav({
	page,
	onPage,
	query,
	onQuery,
	onSearchKeyDown,
	searchRef,
	activeResultId,
	resultsId,
}: SettingsNavProps) {
	const currentGroup = pageById(page).group;

	return (
		<aside className="flex w-[232px] flex-none flex-col border-r border-[var(--line)]">
			<div className="flex-none p-3 pb-2">
				<div className="flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-transparent bg-[var(--sunken)] pr-1 pl-2.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
					<Icon name="search" size={14} className="flex-none text-[var(--ink-muted)]" />
					<input
						ref={searchRef}
						type="search"
						role="combobox"
						aria-expanded={query.trim() !== ""}
						aria-controls={resultsId}
						aria-activedescendant={activeResultId}
						aria-label="Search settings"
						placeholder="Search settings"
						autoComplete="off"
						spellCheck={false}
						value={query}
						onChange={(event) => onQuery(event.target.value)}
						onKeyDown={onSearchKeyDown}
						className="min-w-0 flex-1 bg-transparent text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
					/>
					{query ? (
						<button
							type="button"
							aria-label="Clear search"
							title="Clear search"
							onClick={() => {
								onQuery("");
								searchRef.current?.focus();
							}}
							className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
						>
							<Icon name="close" size={12} />
						</button>
					) : (
						<kbd
							aria-hidden
							className="mr-1 flex-none rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-1.5 font-sans text-[length:var(--text-micro)] text-[var(--ink-muted)]"
						>
							{isMac ? "Cmd F" : "Ctrl F"}
						</kbd>
					)}
				</div>
			</div>

			<nav aria-label="Settings sections" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-3">
				{GROUPS.map((group) => {
					const pages = pagesOf(group.id);
					const open = group.id === currentGroup && query.trim() === "";
					const unfolded = open && pages.length > 1;
					return (
						<div key={group.id}>
							<button
								type="button"
								data-group={group.id}
								data-page={pages.length === 1 ? pages[0]!.id : undefined}
								aria-current={open && !unfolded ? "page" : undefined}
								aria-expanded={pages.length > 1 ? unfolded : undefined}
								onClick={() => onPage(open && pages.length > 1 ? page : firstPageOf(group.id))}
								style={{ height: "var(--row-height)" }}
								className={[
									"flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-left text-[length:var(--text-base)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]",
									open && !unfolded
										? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
										: open
											? "font-[var(--weight-medium)] text-[var(--ink)]"
											: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
								].join(" ")}
							>
								<Icon name={group.icon} size={16} className="flex-none" />
								<span className="min-w-0 flex-1 truncate">{group.label}</span>
								{pages.length > 1 ? (
									<Icon
										name="chevron-down"
										size={12}
										className={`flex-none transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] ${unfolded ? "" : "-rotate-90"}`}
									/>
								) : null}
							</button>

							{unfolded ? (
								<ul className="mt-0.5 mb-1 ml-[19px] flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
									{pages.map((item) => {
										const here = item.id === page;
										return (
											<li key={item.id}>
												<button
													type="button"
													data-page={item.id}
													aria-current={here ? "page" : undefined}
													onClick={() => onPage(item.id)}
													style={{ height: "32px" }}
													className={[
														"flex w-full items-center rounded-[var(--radius-md)] px-2.5 text-left text-[length:var(--text-dense)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]",
														here
															? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
															: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
													].join(" ")}
												>
													<span className="min-w-0 truncate">{item.label}</span>
												</button>
											</li>
										);
									})}
								</ul>
							) : null}
						</div>
					);
				})}
			</nav>
		</aside>
	);
}
