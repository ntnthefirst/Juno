import type { CalendarScope } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";

type ScopeDialogProps = {
	/** What the answer is for: "edit", "move" or "delete". */
	verb: string;
	title: string;
	onChoose: (scope: CalendarScope) => void;
	onClose: () => void;
};

/**
 * The recurrence question, asked properly and every time. Nothing here
 * remembers an answer: a series edited this way once is asked again next time.
 */
export function ScopeDialog({ verb, title, onChoose, onClose }: ScopeDialogProps) {
	const capitalised = verb.charAt(0).toUpperCase() + verb.slice(1);
	return (
		<Dialog title={`${capitalised} repeating event`} width="narrow" onClose={onClose}>
			<p className="mt-3 text-[length:var(--text-dense)] text-[var(--ink-muted)]">{title}</p>
			<div className="mt-5 flex flex-col gap-1">
				<Button onClick={() => onChoose("this")}>
					<span className="w-full text-left">This occurrence</span>
				</Button>
				<Button onClick={() => onChoose("following")}>
					<span className="w-full text-left">This and following occurrences</span>
				</Button>
				<Button onClick={() => onChoose("all")}>
					<span className="w-full text-left">All occurrences</span>
				</Button>
			</div>
			<div className="mt-5 flex justify-end">
				<Button onClick={onClose}>Cancel</Button>
			</div>
		</Dialog>
	);
}
