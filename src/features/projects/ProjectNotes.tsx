import { InlineNotes } from "../../components/InlineNotes";

type ProjectNotesProps = {
	projectId: string;
	notes: string | null;
};

/** The project's own notes, written in place and saved as they are typed. */
export function ProjectNotes({ projectId, notes }: ProjectNotesProps) {
	return (
		<InlineNotes
			notes={notes}
			save={(next) => window.juno.projects.update(projectId, { notes: next })}
			ariaLabel="Project notes"
			placeholder="Anything worth keeping about this project. Headings, lists and links work as you type."
		/>
	);
}
