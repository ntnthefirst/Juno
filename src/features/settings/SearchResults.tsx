import { Fragment } from "react";
import { Icon } from "../../components/Icon";
import { groupById } from "./pages";
import { locationOf, queryWords, resultId, type SettingEntry } from "./search";

type SearchResultsProps = {
	query: string;
	results: SettingEntry[];
	/** Index of the result Enter would open. */
	active: number;
	onActive: (index: number) => void;
	onPick: (entry: SettingEntry) => void;
	/** A suggestion was pressed: search for that word instead. */
	onSuggest: (word: string) => void;
	/** The id the list carries, which the search field points at. */
	id: string;
};

/** Words that find something in nearly every install, for a search that found nothing. */
const SUGGESTIONS = ["theme", "lock", "mail", "backup", "signature", "updates"];

/**
 * What the search found, drawn as the page.
 *
 * A drop-down under a narrow field shows four lines and hides the rest behind
 * a scroll. This is the whole pane: every result with what it does and where it
 * lives, the words that matched picked out, and the first one already chosen so
 * Enter goes straight there.
 */
export function SearchResults({ query, results, active, onActive, onPick, onSuggest, id }: SearchResultsProps) {
	const words = queryWords(query);

	return (
		<div className="px-8 py-7">
			<header className="mb-5">
				<h1 className="text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">Search</h1>
				<p role="status" aria-live="polite" className="mt-1 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					{results.length === 0
						? `Nothing matches "${query.trim()}".`
						: `${results.length} ${results.length === 1 ? "setting matches" : "settings match"} "${query.trim()}".`}
				</p>
			</header>

			{results.length === 0 ? (
				<div className="max-w-[56ch]">
					<p className="text-[var(--ink-muted)]">
						Try a shorter word, or the thing you want to change: the theme, the lock, a mail account.
					</p>
					<div className="mt-4 flex flex-wrap gap-2">
						{SUGGESTIONS.map((word) => (
							<button
								key={word}
								type="button"
								onClick={() => onSuggest(word)}
								className="h-8 rounded-[var(--radius-full)] border border-[var(--line-strong)] px-3 text-[length:var(--text-dense)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
							>
								{word}
							</button>
						))}
					</div>
				</div>
			) : (
				<>
					<ul id={id} role="listbox" aria-label="Matching settings" className="flex flex-col gap-1">
						{results.map((entry, index) => {
							const here = index === active;
							const location = locationOf(entry).split(" > ");
							return (
								<li key={`${entry.anchor}:${entry.title}`} id={resultId(id, index)} role="option" aria-selected={here}>
									<button
										type="button"
										tabIndex={-1}
										onMouseMove={() => {
											if (!here) onActive(index);
										}}
										onClick={() => onPick(entry)}
										className={[
											"flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
											here ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
										].join(" ")}
									>
										<span
											aria-hidden
											className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--sunken)] text-[var(--ink-muted)]"
										>
											<Icon name={groupById(entry.tab).icon} size={16} />
										</span>
										<span className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="truncate text-[length:var(--text-base)] text-[var(--ink)]">
												<Marked text={entry.title} words={words} />
											</span>
											<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												<Marked text={entry.description} words={words} />
											</span>
										</span>
										<span className="flex flex-none items-center gap-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{location.map((part, partIndex) => (
												<Fragment key={part}>
													{partIndex > 0 ? <Icon name="chevron-right" size={10} /> : null}
													<span>{part}</span>
												</Fragment>
											))}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
					<p className="mt-5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Up and down move between results, Enter opens one, Escape clears the search.
					</p>
				</>
			)}
		</div>
	);
}

function escapeForPattern(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type MarkedProps = {
	text: string;
	words: string[];
};

/** The text with the words that matched picked out, in the accent and a heavier weight. */
function Marked({ text, words }: MarkedProps) {
	if (words.length === 0) return <>{text}</>;
	const pattern = new RegExp(`(${words.map(escapeForPattern).join("|")})`, "gi");
	const parts = text.split(pattern);
	return (
		<>
			{parts.map((part, index) =>
				// Split with a capture group puts every match at an odd index.
				index % 2 === 1 ? (
					<mark key={index} className="bg-transparent font-[var(--weight-semibold)] text-[var(--accent)]">
						{part}
					</mark>
				) : (
					<Fragment key={index}>{part}</Fragment>
				),
			)}
		</>
	);
}
