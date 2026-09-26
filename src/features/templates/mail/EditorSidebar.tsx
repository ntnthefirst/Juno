import { useId } from "react";
import type { MailLayout } from "@shared/types";
import { Button } from "../../../components/Button";
import { Icon } from "../../../components/Icon";
import type { DropTarget, Selection } from "./canvas/CanvasView";
import { LayerTree } from "./canvas/LayerTree";

/** What the middle of the editor is showing. */
export type EditorMode = "canvas" | "preview" | "code" | "inputs";

type LayerTarget = { sectionId: string; blockId?: string };

type EditorSidebarProps = {
	name: string;
	description: string;
	subject: string;
	onName: (name: string) => void;
	onDescription: (description: string) => void;
	onSubject: (subject: string) => void;

	layout: MailLayout | null;
	selection: Selection;
	onSelect: (selection: Selection) => void;
	onHidden: (target: LayerTarget, hidden: boolean) => void;
	onDropBlock: (fromSectionId: string, blockId: string, target: DropTarget) => void;
	onDropSection: (sectionId: string, beforeSectionId: string | null) => void;
	onStep: (target: LayerTarget, by: -1 | 1) => void;
	/** Swaps the whole canvas for hand-written HTML, and back. */
	onConvert: () => void;

	unreviewed: boolean;

	autosave: boolean;
	onAutosave: (on: boolean) => void;
	status: string;
	dirty: boolean;
	saving: boolean;
	onSave: () => void;

	onCollapse: () => void;
};

const QUIET_FIELD =
	"w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-[var(--ink)] placeholder:text-[var(--ink-muted)] hover:bg-[var(--sunken)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none";

/**
 * The left panel: what the template is, what is in it, and whether it is
 * saved.
 *
 * The name and the description sit at the top because they are the two things
 * an author changes without looking at the canvas, and the layers sit under
 * them because that is where a tree belongs. Which view the middle shows is on
 * the toolbar over the canvas, the way Figma keeps its modes there. The panel
 * folds away to a bar over the canvas, which is what a screen narrow enough to
 * need the room does with it.
 */
export function EditorSidebar({
	name,
	description,
	subject,
	onName,
	onDescription,
	onSubject,
	layout,
	selection,
	onSelect,
	onHidden,
	onDropBlock,
	onDropSection,
	onStep,
	onConvert,
	unreviewed,
	autosave,
	onAutosave,
	status,
	dirty,
	saving,
	onSave,
	onCollapse,
}: EditorSidebarProps) {
	const nameId = useId();
	const descriptionId = useId();
	const subjectId = useId();

	return (
		<div className="flex h-full min-h-0 w-[240px] flex-none flex-col border-r border-[var(--line)] bg-[var(--surface)]">
			<div className="flex flex-none items-center gap-0.5 px-1.5 pt-1.5">
				<div className="min-w-0 flex-1">
					<label htmlFor={nameId} className="sr-only">
						Template name
					</label>
					<input
						id={nameId}
						value={name}
						onChange={(event) => onName(event.target.value)}
						placeholder="Untitled template"
						className={`${QUIET_FIELD} truncate text-[length:var(--text-dense)] font-[var(--weight-semibold)]`}
					/>
				</div>
				<button
					type="button"
					aria-label="Hide the panel"
					title="Hide the panel"
					onClick={onCollapse}
					className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					<Icon name="sidebar" size={14} />
				</button>
			</div>

			<div className="flex-none px-1.5 pb-1.5">
				<label htmlFor={descriptionId} className="sr-only">
					Description
				</label>
				<textarea
					id={descriptionId}
					rows={2}
					value={description}
					onChange={(event) => onDescription(event.target.value)}
					placeholder="What this one is for"
					className={`${QUIET_FIELD} resize-none text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-[var(--ink-muted)]`}
				/>
			</div>

			<div className="flex-none border-t border-[var(--line)] px-1.5 py-1.5">
				<label htmlFor={subjectId} className="block px-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
					Subject
				</label>
				{/* Edited where it is written, like the name, rather than in a box.
				    A subject is one line, so Enter leaves it instead of breaking it,
				    and it wraps rather than hiding the end of a long one. */}
				<textarea
					id={subjectId}
					rows={1}
					value={subject}
					onChange={(event) => onSubject(event.target.value.replace(/[\r\n]+/g, " "))}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.blur();
						}
					}}
					placeholder="Onderwerp"
					className={`${QUIET_FIELD} field-sizing-content resize-none text-[length:var(--text-sm)] leading-[var(--leading-normal)]`}
				/>
				{unreviewed ? (
					<p className="mt-1.5 border-l-2 border-[var(--warn)] pl-2 text-[length:var(--text-micro)] leading-[var(--leading-normal)] text-[var(--warn)]">
						This text shipped with Juno and has not been edited yet. Read it before it is used.
					</p>
				) : null}
			</div>

			<div className="flex min-h-0 flex-1 flex-col border-t border-[var(--line)]">
				<div className="flex h-[28px] flex-none items-center px-3">
					<h2 className="text-[length:var(--text-micro)] font-[var(--weight-semibold)] tracking-[0.04em] text-[var(--ink-muted)] uppercase">
						Layers
					</h2>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
					{layout ? (
						<LayerTree
							layout={layout}
							selection={selection}
							onSelect={onSelect}
							onHidden={onHidden}
							onDropBlock={onDropBlock}
							onDropSection={onDropSection}
							onStep={onStep}
						/>
					) : (
						<p className="px-1.5 text-[length:var(--text-micro)] leading-[var(--leading-normal)] text-[var(--ink-muted)]">
							This template is hand-written HTML, so it has no layers.
						</p>
					)}
				</div>
				<div className="flex-none px-1.5 pb-1.5">
					<button
						type="button"
						onClick={onConvert}
						className="w-full rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[length:var(--text-micro)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
					>
						{layout ? "Turn the whole template into hand-written HTML" : "Lay this out on a canvas"}
					</button>
				</div>
			</div>

			<div className="flex flex-none items-center gap-2 border-t border-[var(--line)] px-3 py-1.5">
				<label className="flex items-center gap-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
					<input
						type="checkbox"
						checked={autosave}
						onChange={(event) => onAutosave(event.target.checked)}
						className="h-3.5 w-3.5 accent-[var(--accent)]"
					/>
					Autosave
				</label>
				{status ? (
					<span
						className={`truncate text-[length:var(--text-micro)] ${dirty ? "text-[var(--ink-muted)]" : "text-[var(--ok)]"}`}
					>
						{status}
					</span>
				) : null}
				<span className="ml-auto" />
				<Button size="dense" variant="primary" disabled={saving || !dirty} onClick={onSave}>
					{saving ? "Saving" : "Save"}
				</Button>
			</div>
		</div>
	);
}
