import { useEffect, useState, type RefObject } from "react";
import { COMBOS, matchesCombo } from "../lib/shortcuts";
import { useFind } from "../lib/use-find";
import { FindBar } from "./FindBar";

type PreviewFindProps = {
	/** What is searched: every piece of text inside it. */
	container: RefObject<HTMLElement | null>;
	/** Anything that changes when the text does, such as the zoom or a page laid out. */
	version: unknown;
	finding: boolean;
	onFinding: (finding: boolean) => void;
};

/**
 * Ctrl or Cmd F inside a file's preview (decision 83): the find bar at the
 * top right of the file, the matches painted where they are. Listened for on
 * the document, which hears the key before the title bar's list search does.
 */
export function PreviewFind({ container, version, finding, onFinding }: PreviewFindProps) {
	const [query, setQuery] = useState("");
	const find = useFind(container, query, finding, version);

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (!matchesCombo(event, COMBOS.find) || document.querySelector("[role='dialog']")) return;
			event.preventDefault();
			onFinding(true);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onFinding]);

	if (!finding) return null;
	return (
		<div className="pointer-events-none absolute top-[60px] right-6 z-20">
			<div className="pointer-events-auto">
				<FindBar
					query={query}
					onQueryChange={setQuery}
					count={find.count}
					current={find.current}
					onNext={find.next}
					onPrevious={find.previous}
					fieldLabel="Find in this file"
					onClose={() => {
						onFinding(false);
						setQuery("");
					}}
				/>
			</div>
		</div>
	);
}
