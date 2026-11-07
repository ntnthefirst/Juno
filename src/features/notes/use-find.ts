import { useCallback, useEffect, useState, type RefObject } from "react";

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
			const ranges: Range[] = [];
			if (active && root && needle !== "") {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					const text = (node.textContent ?? "").toLowerCase();
					for (let from = text.indexOf(needle); from >= 0; from = text.indexOf(needle, from + needle.length)) {
						const range = document.createRange();
						range.setStart(node, from);
						range.setEnd(node, from + needle.length);
						ranges.push(range);
					}
				}
			}
			setCount(ranges.length);
			if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
			CSS.highlights.delete("find");
			CSS.highlights.delete("find-current");
			if (ranges.length === 0) return;
			const index = Math.min(current, ranges.length - 1);
			CSS.highlights.set("find", new Highlight(...ranges.filter((_, i) => i !== index)));
			const here = ranges[index];
			if (here) {
				CSS.highlights.set("find-current", new Highlight(here));
				here.startContainer.parentElement?.scrollIntoView({ block: "nearest" });
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
			if (typeof CSS !== "undefined" && "highlights" in CSS) {
				CSS.highlights.delete("find");
				CSS.highlights.delete("find-current");
			}
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
