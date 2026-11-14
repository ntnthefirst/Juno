import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DocumentPlace, FilePreviewSource, ImportAnalysis, ImportMatch, ImportSource, TextComparison } from "@shared/types";
import { Button } from "../../components/Button";
import { IconAction } from "../../components/IconAction";
import { Segmented } from "../../components/Segmented";
import { useContentHost } from "../../lib/content-host";
import { messageOf } from "../../lib/errors";
import { fileTypeLabel } from "../../lib/file-type";
import { modifiedLabel } from "../../lib/modified-label";
import { announceDocumentsChanged, type ImportItem, type ImportOutcome } from "../../lib/pdf-drop";
import { formatBytes } from "../projects/format";
import { ComparePane } from "./ComparePane";
import { diffSummary } from "./diff-runs";
import { TextDiffView } from "./TextDiffView";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "./DocumentOwnerFields";
import { firstMatch, needsAsking, reasonFor } from "./import-reasons";

type AddFilesFlowProps = {
	items: ImportItem[];
	/**
	 * Where the files go: the folder that is open, a client's or a project's
	 * own place. Null when nothing says, as for a drop outside Documents: then
	 * the first question is where.
	 */
	place: DocumentPlace | null;
	/** The place's name, for the heading. */
	placeName?: string;
	onDone: (outcome: ImportOutcome) => void;
};

type Step =
	| { status: "where" }
	| { status: "reading" }
	| { status: "asking"; analysis: ImportAnalysis; match: ImportMatch }
	| { status: "saving"; analysis: ImportAnalysis; match: ImportMatch };

/** A preview source for the file being added. A drop is its own bytes; a mail attachment is named by id. */
function previewOf(source: ImportSource): FilePreviewSource {
	return source.kind === "attachment"
		? { kind: "attachment", attachmentId: source.attachmentId }
		: { kind: "bytes", fileName: source.fileName, data: source.data, ...(source.fileDate ? { fileDate: source.fileDate } : {}) };
}

/** Keeps the file as a document of its own, in the place chosen. */
async function keepSeparate(source: ImportSource, target: DocumentPlace, title?: string): Promise<void> {
	if (source.kind === "attachment") {
		await window.juno.documents.importFromMail({
			attachmentId: source.attachmentId,
			clientId: target.clientId,
			projectId: target.projectId,
			folderId: target.folderId,
			...(title ? { title } : {}),
		});
		return;
	}
	await window.juno.documents.importFile({
		source,
		clientId: target.clientId,
		projectId: target.projectId,
		folderId: target.folderId,
		...(title ? { title } : {}),
	});
}

async function addAsVersion(source: ImportSource, documentId: string): Promise<void> {
	if (source.kind === "attachment") {
		await window.juno.documents.importFromMail({ attachmentId: source.attachmentId, versionOf: documentId });
		return;
	}
	await window.juno.documents.addVersion({ documentId, source });
}

/** The words compared for one file and one match, keyed so a stale answer is never drawn under another pair. */
type Compared = { key: string; result: TextComparison | null };

const COMPARE_VIEWS = [
	{ id: "files" as const, label: "Side by side" },
	{ id: "words" as const, label: "What differs" },
];

/** How long a read may take before the flow says so, so a quick batch does not flash a frame. */
const READING_DELAY_MS = 300;

const metaLine =(fileName: string | null, mediaType: string, size: number | null, date: string | null) =>
	[fileTypeLabel(fileName, mediaType), size === null ? "" : formatBytes(size), modifiedLabel(date)].filter(Boolean).join(" · ");

/**
 * Adding files is one step (decision 75). Each file is read by the main
 * process first; one that looks like nothing here goes straight in. One that
 * looks like a document already kept is shown beside that document's newest
 * file, with the reason in plain words, and the person picks: a new version
 * of that one, or a document of its own. Nothing is filed as a version on a
 * guess. A file whose very bytes are already a version says so and offers to
 * skip it.
 *
 * It covers the content area rather than sitting in a dialog, because the
 * question has two answers but needs the room to show both files (decision
 * 30). Several files are steps, one after another.
 */
export function AddFilesFlow({ items, place, placeName, onDone }: AddFilesFlowProps) {
	const host = useContentHost();
	const [index, setIndex] = useState(0);
	const [where, setWhere] = useState<DocumentPlace | null>(place);
	const [owner, setOwner] = useState<DocumentOwnerChoice>({ clientId: "", projectId: "" });
	const [step, setStep] = useState<Step>(place ? { status: "reading" } : { status: "where" });
	const [error, setError] = useState<string | null>(null);
	const [compared, setCompared] = useState<Compared | null>(null);
	const [compareView, setCompareView] = useState<"files" | "words">("files");
	// Nothing is drawn while a file is read quickly, so a batch does not flash a frame per file.
	// Once a read has taken longer than READING_DELAY_MS, or a question has been asked, the
	// frame stays up until the flow is done, and a read between two files shows its progress.
	const [shown, setShown] = useState(!place);
	// Cancel while a file is read stops after that file: the read is already in the main process.
	const [stopping, setStopping] = useState(false);
	const stop = useRef(false);
	const outcome = useRef<ImportOutcome>({ documents: 0, versions: 0, skipped: 0, failures: [] });
	const finished = useRef(false);
	// Held in a ref so a parent that re-renders with a new callback does not start the current file over.
	const done = useRef(onDone);
	useEffect(() => {
		done.current = onDone;
	});

	const item = items[index];

	const finish = useCallback(() => {
		if (finished.current) return;
		finished.current = true;
		if (outcome.current.documents + outcome.current.versions > 0) announceDocumentsChanged();
		done.current(outcome.current);
	}, []);

	const requestStop = useCallback(() => {
		stop.current = true;
		setStopping(true);
	}, []);

	const reading = step.status === "reading" && where !== null;
	useEffect(() => {
		if (!reading || shown) return;
		const timer = window.setTimeout(() => setShown(true), READING_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [reading, shown, index]);

	// Escape cancels what is left while a question is on screen, the way the close button does,
	// and stops after the current file while one is read. Caught before the window's other
	// listeners, so a preview underneath does not close with it, and swallowed while a file is
	// being kept, so the preview does not close under the flow.
	const asking = step.status === "where" || step.status === "asking";
	const drawn = shown;
	useEffect(() => {
		if (!drawn) return;
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector("[role='dialog'], [role='menu']")) return;
			// An open list under a field closes on its own Escape and leaves the flow alone.
			if (event.target instanceof HTMLElement && event.target.getAttribute("aria-expanded") === "true") return;
			event.preventDefault();
			if (asking) finish();
			else if (reading) requestStop();
		}
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [drawn, asking, reading, finish, requestStop]);

	// The flow takes the focus when it first draws, so the list's keys and a
	// preview's arrows underneath do not act on what it covers, and gives it
	// back to whatever had it when it is done.
	const frameRef = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!drawn) return;
		opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
		frameRef.current?.focus({ preventScroll: true });
	}, [drawn]);
	// An answer's button goes with its question, which would drop the focus on the page;
	// it comes back to the frame, so the keys still belong to the flow.
	useEffect(() => {
		const frame = frameRef.current;
		if (!drawn || !frame || frame.contains(document.activeElement)) return;
		frame.focus({ preventScroll: true });
	}, [drawn, step.status, index]);
	useEffect(
		() => () => {
			const back = opener.current;
			if (back && back !== document.body && back.isConnected) back.focus({ preventScroll: true });
		},
		[],
	);

	// Reads the file at `index` once the place is known, and either adds it or asks.
	useEffect(() => {
		if (!where) return;
		const current = items[index];
		if (!current) {
			finish();
			return;
		}
		let cancelled = false;
		(async () => {
			const analysis = await window.juno.documents.analyseImport({
				source: current.source,
				clientId: where.clientId,
				projectId: where.projectId,
				folderId: where.folderId,
			});
			if (cancelled) return;
			const match = firstMatch(analysis);
			if (!needsAsking(analysis) || !match) {
				await keepSeparate(current.source, where, analysis.availableTitle);
				if (cancelled) return;
				outcome.current.documents += 1;
				if (stop.current) finish();
				else setIndex((at) => at + 1);
				return;
			}
			// Stopped while this one was read: a question nobody is waiting for is not asked.
			if (stop.current) {
				finish();
				return;
			}
			setError(null);
			setShown(true);
			setStep({ status: "asking", analysis, match });
		})().catch((cause: unknown) => {
			if (cancelled) return;
			outcome.current.failures.push({ name: current.label, message: messageOf(cause) });
			if (stop.current) finish();
			else setIndex((at) => at + 1);
		});
		return () => {
			cancelled = true;
		};
	}, [index, where, items, finish]);

	// When a file is shown beside a document, its words are compared with that
	// document's newest file, so the person can see what the share leaves out.
	const asked = (step.status === "asking" || step.status === "saving") && !step.match.identical ? step.match : null;
	const compareKey = asked?.latestVersion ? `${index}:${asked.documentId}:${asked.latestVersion.id}` : null;
	const askedVersion = asked?.latestVersion?.id ?? null;
	useEffect(() => {
		const current = items[index];
		if (!compareKey || !askedVersion || !current) return;
		let cancelled = false;
		window.juno.documents
			.compareText({ before: { kind: "version", versionId: askedVersion }, after: current.source })
			.then((result) => {
				if (!cancelled) setCompared({ key: compareKey, result });
			})
			.catch(() => {
				if (!cancelled) setCompared({ key: compareKey, result: null });
			});
		return () => {
			cancelled = true;
		};
	}, [compareKey, askedVersion, index, items]);

	function next(result: "documents" | "versions" | "skipped") {
		outcome.current[result] += 1;
		setStep({ status: "reading" });
		setIndex((current) => current + 1);
	}

	async function answer(choice: "version" | "separate") {
		if (!item || !where || step.status !== "asking") return;
		const { analysis, match } = step;
		setError(null);
		setStep({ status: "saving", analysis, match });
		try {
			if (choice === "version") {
				await addAsVersion(item.source, match.documentId);
				next("versions");
			} else {
				await keepSeparate(item.source, where, analysis.availableTitle);
				next("documents");
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setStep({ status: "asking", analysis, match });
		}
	}

	// What was not reached is left out of the count: a cancel is not news worth a toast.
	// While a file is read, the flow stops once that file is done instead.
	function cancelAll() {
		if (reading) requestStop();
		else finish();
	}

	const heading = placeName ? `Add to ${placeName}` : "Add files";
	const counter = items.length > 1 ? `File ${Math.min(index + 1, items.length)} of ${items.length}` : null;

	let body: ReactNode = null;
	if (step.status === "where") {
		body = (
			<div className="flex h-full items-start justify-center overflow-y-auto p-10">
				<div className="w-full max-w-[620px]">
					<h3 className="text-h3">Where should {items.length === 1 ? "this file" : "these files"} go?</h3>
					<p className="mt-1 max-w-[62ch] text-sm text-[var(--ink-muted)]">
						Choose a client, a project, both or neither. Leave both empty to keep them in Unfiled.
					</p>
					<ul className="mt-4 flex flex-col gap-1 text-dense text-[var(--ink-muted)]">
						{items.slice(0, 8).map((entry, at) => (
							<li key={`${at}:${entry.label}`} className="truncate">
								{entry.label}
							</li>
						))}
						{items.length > 8 ? <li>and {items.length - 8} more</li> : null}
					</ul>
					<div className="mt-6">
						<DocumentOwnerFields value={owner} onChange={setOwner} />
					</div>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={cancelAll}>Cancel</Button>
						<Button
							variant="primary"
							onClick={() => {
								setStep({ status: "reading" });
								setWhere({ clientId: owner.clientId || null, projectId: owner.projectId || null, folderId: null });
							}}
						>
							{items.length === 1 ? "Add the file" : `Add ${items.length} files`}
						</Button>
					</div>
				</div>
			</div>
		);
	} else if ((step.status === "asking" || step.status === "saving") && item) {
		const { analysis, match } = step;
		const busy = step.status === "saving";
		const existing = match.latestVersion;
		const words = compared && compared.key === compareKey && compared.result?.status === "compared" ? compared.result : null;
		const changed = words !== null && words.added + words.removed > 0;
		const showWords = changed && compareView === "words";
		body = (
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex-none px-6 pt-5 pb-4">
					<p className="text-lg font-[var(--weight-medium)]">{reasonFor(match)}.</p>
					<p className="mt-1 max-w-[72ch] text-sm text-[var(--ink-muted)]">
						{match.identical
							? "Nothing would change by adding it again. Skip it, or keep a separate copy anyway."
							: `Add it as the next version of ${match.title}, or keep it as a document of its own named ${analysis.availableTitle}.`}
					</p>
					{changed ? (
						<div className="mt-3 flex flex-wrap items-center gap-3">
							<Segmented size="compact" label="Compare by" value={compareView} onChange={setCompareView} options={COMPARE_VIEWS} />
							<p className="tabular text-sm text-[var(--ink-muted)]">
								{diffSummary(words.added, words.removed)}
								{words.truncated ? " Only the start was compared." : ""}
							</p>
						</div>
					) : null}
					{analysis.matches.length > 1 ? (
						<div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Documents it looks like">
							{analysis.matches.map((other) => (
								<button
									key={other.documentId}
									type="button"
									aria-pressed={other.documentId === match.documentId}
									onClick={() => setStep({ status: "asking", analysis, match: other })}
									className={`h-[28px] max-w-[260px] truncate rounded-[var(--radius-md)] px-3 text-dense transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
										other.documentId === match.documentId
											? "bg-[var(--accent-soft)] text-[var(--accent)]"
											: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
									}`}
								>
									{other.title}
								</button>
							))}
						</div>
					) : null}
				</div>
				<div className="flex min-h-0 flex-1 gap-4 px-6">
					{showWords ? (
						<TextDiffView
							key={compareKey}
							parts={words.parts}
							addedLabel={analysis.fileName}
							removedLabel={match.title}
							truncated={words.truncated}
						/>
					) : (
						<>
							<ComparePane
								label="Adding"
								name={analysis.fileName}
								meta={metaLine(analysis.fileName, analysis.mediaType, analysis.byteSize, analysis.fileDate)}
								source={previewOf(item.source)}
								emphasis
							/>
							<ComparePane
								key={match.documentId}
								label={`Already in Juno${match.clientName ? `, ${match.clientName}` : ""}`}
								name={match.title}
								meta={existing ? metaLine(existing.fileName, existing.mediaType, existing.byteSize, existing.fileDate) : ""}
								source={existing ? { kind: "version", versionId: existing.id } : null}
							/>
						</>
					)}
				</div>
				{error ? (
					<p role="alert" data-selectable className="mx-6 mt-3 flex-none border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
						{error}
					</p>
				) : null}
				<div className="flex flex-none items-center justify-end gap-2 px-6 py-4">
					<Button onClick={cancelAll}>{items.length - index > 1 ? "Cancel the rest" : "Cancel"}</Button>
					{match.identical ? (
						<>
							<Button disabled={busy} onClick={() => void answer("separate")}>
								Keep a separate copy
							</Button>
							<Button variant="primary" disabled={busy} onClick={() => next("skipped")}>
								Skip this file
							</Button>
						</>
					) : (
						<>
							<Button disabled={busy} onClick={() => void answer("separate")}>
								Keep as a separate document
							</Button>
							<Button variant="primary" disabled={busy} onClick={() => void answer("version")}>
								{busy ? "Adding" : "Add as a new version"}
							</Button>
						</>
					)}
				</div>
			</div>
		);
	} else if (reading && drawn) {
		const current = items[index];
		const many = items.length > 1;
		body = (
			<div className="flex h-full items-center justify-center p-10">
				<div className="w-full max-w-[420px]">
					<div role="status" aria-live="polite">
						<p className="truncate text-base">{stopping ? "Stopping after this file" : `Reading ${current?.label ?? "the file"}`}</p>
						<p className="mt-1 text-sm text-[var(--ink-muted)]">
							{stopping
								? "The file being read is finished first. Nothing after it is added."
								: "A file that looks like nothing here goes straight in."}
						</p>
					</div>
					{many ? (
						<div className="mt-4 h-[4px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--line)]" aria-hidden="true">
							<div
								className="h-full origin-left bg-[var(--accent)] transition-transform duration-[var(--duration-base)] ease-[var(--ease-smooth)]"
								style={{ transform: `scaleX(${index / items.length})` }}
							/>
						</div>
					) : null}
					<div className="mt-6 flex justify-end">
						<Button disabled={stopping} onClick={requestStop}>
							{stopping ? "Stopping" : many ? "Cancel the rest" : "Cancel"}
						</Button>
					</div>
				</div>
			</div>
		);
	} else {
		// Read quickly so far, or adding a file that needed no question: nothing to draw yet.
		return null;
	}

	const frame = (
		<div
			ref={frameRef}
			tabIndex={-1}
			role="region"
			aria-label={heading}
			data-add-files
			className="animate-scale absolute inset-0 z-30 flex flex-col bg-[var(--surface)] focus:outline-none"
		>
			<div className="flex h-[56px] flex-none items-center gap-3 border-b border-[var(--line)] pr-4 pl-2">
				<IconAction icon="close" label="Cancel" size="base" onClick={cancelAll} />
				<h2 className="min-w-0 flex-1 truncate text-base font-[var(--weight-medium)]">{heading}</h2>
				{counter ? <span className="tabular flex-none text-sm text-[var(--ink-muted)]">{counter}</span> : null}
			</div>
			<div className="min-h-0 flex-1 bg-[var(--sunken)]/40">
				{/* Keyed by what is asked, so the next file's question fades in over the reading line and not on every answer. */}
				<div key={step.status === "asking" || step.status === "saving" ? `ask:${index}` : step.status} className="animate-fade h-full">
					{body}
				</div>
			</div>
		</div>
	);
	return host ? createPortal(frame, host) : frame;
}
