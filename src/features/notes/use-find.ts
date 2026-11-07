import { useCallback, useEffect, useState, type RefObject } from "react";

type Match = { range: Range } | { cell: HTMLInputElement };

/** Takes every mark of a search off the page: the painted ranges and the marked cells. */
function clear(root: HTMLElement | null): void {
	if (typeof CSS !== "undefined" && "highlights" in CSS) {
		CSS.highlights.delete("find");
		CSS.highlights.delete("find-current");
	}
	root?.querySelectorAll<HTMLElement>("[data-find]").forEach((element) => delete element.dataset.find);
}

/**
 * Find inside an editor. The matches are painted with the CSS Custom Highlight
 * API rather than wrapped in markup, so the text the person is editing is never
 * touched and nothing has to be unwrapped before the next keystroke.
 *
 * `version` is anything that changes when the text does (the blocks), so the
 * count follows an edit made while the bar is open. The count is read from the
 * page after it has painted, which is why it arrives a frame later.
 */
export function useFind(container: RefObject<HTMLElement | null>, query: string, active: boolean, version: unknown) {
	const [count, setCount] = useState(0);
	// The position belongs to the word it was reached for, so a new word starts at the first match.
	const [position, setPosition] = useState({ query, index: 0 });
	const current = position.query === query ? position.index : 0;

	useEffect(() => {
		const root = container.current;
		const needle = query.toLowerCase();
		const frame = window.requestAnimationFrame(() => {
			// A match is a stretch of text, or a table cell, whose words live in an
			// input's value where no text node and no Range can reach them. A cell is
			// marked with an attribute instead, and the document order of both kinds
			// is kept so Next and Previous walk the page top to bottom.
			const matches: Match[] = [];
			if (active && root && needle !== "") {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					if (node instanceof HTMLInputElement) {
						const value = node.value.toLowerCase();
						for (let from = value.indexOf(needle); from >= 0; from = value.indexOf(needle, from + needle.length)) {
							matches.push({ cell: node });
						}
						continue;
					}
					if (node.nodeType !== Node.TEXT_NODE) continue;
					const text = (node.textContent ?? "").toLowerCase();
					for (let from = text.indexOf(needle); from >= 0; from = text.indexOf(needle, from + needle.length)) {
						const range = document.createRange();
						range.setStart(node, from);
						range.setEnd(node, from + needle.length);
						matches.push({ range });
					}
				}
			}
			setCount(matches.length);
			clear(root);
			if (matches.length === 0) return;
			const index = Math.min(current, matches.length - 1);
			const ranges: Range[] = [];
			let currentRange: Range | undefined;
			for (const [i, match] of matches.entries()) {
				if ("cell" in match) {
					match.cell.dataset.find = i === index ? "current" : "match";
				} else if (i === index) {
					currentRange = match.range;
				} else {
					ranges.push(match.range);
				}
			}
			if (typeof CSS !== "undefined" && "highlights" in CSS) {
				CSS.highlights.set("find", new Highlight(...ranges));
				if (currentRange) CSS.highlights.set("find-current", new Highlight(currentRange));
			}
			const here = matches[index];
			const target = here && ("cell" in here ? here.cell : here.range.startContainer.parentElement);
			target?.scrollIntoView({ block: "nearest" });
		});
		return () => {
			window.cancelAnimationFrame(frame);
			clear(root);
		};
	}, [container, query, active, version, current]);

	const next = useCallback(
		() => setPosition({ query, index: count === 0 ? 0 : (current + 1) % count }),
		[query, count, current],
	);
	const previous = useCallback(
		() => setPosition({ query, index: count === 0 ? 0 : (current - 1 + count) % count }),
		[query, count, current],
	);

	return { count, current: count === 0 ? -1 : Math.min(current, count - 1), next, previous };
}
