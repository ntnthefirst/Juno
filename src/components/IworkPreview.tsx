import { useRef, useState } from "react";
import type { IworkApp, IworkSection } from "@shared/types";
import { usePreviewZoom } from "../lib/use-preview-zoom";
import { PreviewFind } from "./PreviewFind";
import { ZoomControls } from "./ZoomControls";

type IworkPreviewProps = {
	app: IworkApp;
	name: string;
	/** The picture the file carries of its first page, at an `app://preview/` address. */
	cover: string | null;
	sections: IworkSection[];
	truncated: boolean;
};

const APP_NAMES: Record<IworkApp, string> = { pages: "Pages", numbers: "Numbers", keynote: "Keynote" };

/** What each part is called above it. The running text of a document needs no heading. */
const HEADINGS: Record<IworkSection["role"], string | null> = {
	body: null,
	slides: "On its slides",
	notes: "Presenter notes",
	tables: "In its tables",
	boxes: "In its text boxes and notes",
};

/**
 * A Pages, Numbers or Keynote file (decision 83). Windows has nothing that
 * draws one, so this is the picture the file carries of its first page,
 * followed by its words, read from the file itself: selectable, copied as
 * text, found with Ctrl or Cmd F, and zoomed with the type. A sentence under
 * the picture says what this is and is not.
 */
export function IworkPreview({ app, name, cover, sections, truncated }: IworkPreviewProps) {
	const area = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [finding, setFinding] = useState(false);
	const zoom = usePreviewZoom(1, area);
	const order = app === "pages" ? "" : " They are in the order the file keeps them, which may not be the order they are shown.";
	return (
		<div className="animate-fade relative flex h-full min-h-0 flex-col bg-[var(--surface)]">
			<div className="flex h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4">
				<p className="min-w-0 truncate text-sm text-[var(--ink-muted)]">Read from the {APP_NAMES[app]} file. Open it to see its layout.</p>
				<ZoomControls zoom={zoom} fitLabel="Actual size" />
			</div>
			<PreviewFind container={body} version={zoom.scale} finding={finding} onFinding={setFinding} />
			<div ref={area} className="min-h-0 flex-1 overflow-auto" data-iwork-preview>
				<div ref={body} style={{ zoom: zoom.scale }} className="mx-auto max-w-[80ch] px-8 py-6">
					{cover ? (
						<figure className="mb-8">
							<img
								src={cover}
								alt={`The first page of ${name}`}
								draggable={false}
								className="mx-auto block max-h-[60vh] max-w-full rounded-[var(--radius-sm)] border border-[var(--line)] object-contain shadow-[var(--shadow-popover)]"
							/>
							<figcaption className="mt-2 text-center text-sm text-[var(--ink-muted)]">
								The picture this file carries of itself. Its words follow.{order}
							</figcaption>
						</figure>
					) : (
						<p className="mb-6 text-sm text-[var(--ink-muted)]">The words in this file.{order}</p>
					)}
					{sections.map((section) => {
						const heading = HEADINGS[section.role];
						return (
							<section key={section.role} className="mb-8">
								{heading ? <h3 className="mb-3 text-h3">{heading}</h3> : null}
								<p data-selectable className="font-sans text-document whitespace-pre-wrap text-[var(--ink)]">
									{section.text}
								</p>
							</section>
						);
					})}
				</div>
			</div>
			{truncated ? (
				<p className="flex-none border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-muted)]">
					This is the first part of the file. Open it to read the rest.
				</p>
			) : null}
		</div>
	);
}
