import { useEffect, useRef, useState } from "react";
import type { ImportAnalysis } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { announceDocumentsChanged, type ImportItem, type ImportOutcome } from "../../lib/pdf-drop";
import { DocumentOwnerFields, type DocumentOwnerChoice } from "./DocumentOwnerFields";

type ImportFlowProps = {
	items: ImportItem[];
	/** Set when the files are already known to belong to one client: its own tab. */
	clientId?: string;
	/** Set when they are known to belong to one project: its own page. */
	projectId?: string;
	onDone: (outcome: ImportOutcome) => void;
};

type Choice = { kind: "version"; documentId: string } | { kind: "new" };

type Step =
	| { status: "reading" }
	| { status: "asking"; analysis: ImportAnalysis }
	| { status: "saving"; analysis: ImportAnalysis };

/** "same text, 96%" reads better than a bare number, and says why it was offered. */
function reasonOf(match: ImportAnalysis["matches"][number]): string {
	if (match.identical) return "This exact file is already one of its versions";
	if (match.reason === "name") return "Same name";
	return `Same text, ${Math.round(match.score * 100)}%`;
}

/**
 * Brings files in one at a time, and asks only when there is something to ask.
 *
 * Each file is read by the main process first. When it looks like a document
 * Juno already has, by its text or by its name, the question is whether it is
 * a new version of that document or a document of its own. When neither the
 * client nor the project is known, where to keep it is asked too, and "none"
 * is an answer. A file with nothing to ask about is imported straight away.
 */
export function ImportFlow({ items, clientId, projectId, onDone }: ImportFlowProps) {
	const [index, setIndex] = useState(0);
	const [step, setStep] = useState<Step>({ status: "reading" });
	const [choice, setChoice] = useState<Choice>({ kind: "new" });
	const [owner, setOwner] = useState<DocumentOwnerChoice>({ clientId: "", projectId: "" });
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string | null>(null);
	const outcome = useRef<ImportOutcome>({ documents: 0, versions: 0, skipped: 0, failures: [] });
	const finished = useRef(false);
	// Held in a ref so a parent that re-renders with a new callback does not
	// start the current file over.
	const done = useRef(onDone);
	useEffect(() => {
		done.current = onDone;
	}, [onDone]);

	const item = items[index];

	useEffect(() => {
		if (!item) {
			if (!finished.current) {
				finished.current = true;
				if (outcome.current.documents + outcome.current.versions > 0) announceDocumentsChanged();
				done.current(outcome.current);
			}
			return;
		}
		let cancelled = false;
		(async () => {
			const analysis = await window.juno.documents.analyseImport({ source: item.source, clientId: clientId ?? null });
			if (cancelled) return;
			const usable = analysis.matches.filter((match) => !match.identical);
			// Nothing to ask: where it goes is known and nothing looks like this file.
			if ((clientId || projectId) && analysis.matches.length === 0) {
				await window.juno.documents.importFile({
					source: item.source,
					clientId: clientId ?? null,
					projectId: projectId ?? null,
					title: analysis.defaultTitle,
				});
				if (cancelled) return;
				outcome.current.documents += 1;
				setIndex((current) => current + 1);
				return;
			}
			setChoice(usable[0] ? { kind: "version", documentId: usable[0].documentId } : { kind: "new" });
			setOwner({ clientId: clientId ?? analysis.suggestedClientId ?? "", projectId: projectId ?? "" });
			setTitle(analysis.defaultTitle);
			setStep({ status: "asking", analysis });
		})().catch((cause: unknown) => {
			if (cancelled) return;
			outcome.current.failures.push({ name: item.label, message: messageOf(cause) });
			setIndex((current) => current + 1);
		});
		return () => {
			cancelled = true;
		};
	}, [item, clientId, projectId]);

	if (!item || step.status === "reading") return null;

	const { analysis } = step;
	const busy = step.status === "saving";

	function next(result: "documents" | "versions" | "skipped") {
		outcome.current[result] += 1;
		setStep({ status: "reading" });
		setError(null);
		setIndex((current) => current + 1);
	}

	async function confirm() {
		if (busy || !item) return;
		setError(null);
		setStep({ status: "saving", analysis });
		try {
			if (choice.kind === "version") {
				await window.juno.documents.addVersion({ documentId: choice.documentId, source: item.source });
				next("versions");
			} else {
				await window.juno.documents.importFile({
					source: item.source,
					clientId: owner.clientId || null,
					projectId: owner.projectId || null,
					title: title.trim() || undefined,
				});
				next("documents");
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setStep({ status: "asking", analysis });
		}
	}

	function skip() {
		next("skipped");
	}

	function cancelAll() {
		outcome.current.skipped += items.length - index;
		setIndex(items.length);
	}

	const heading = items.length > 1 ? `Import ${index + 1} of ${items.length}` : "Import a PDF";

	return (
		<Dialog title={heading} onClose={cancelAll}>
			<p data-selectable className="mt-2 truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{analysis.fileName}
			</p>

			{analysis.matches.length > 0 ? (
				<p className="mt-4 text-[length:var(--text-base)]">
					This file looks like a document you already have. Add it as a new version, or keep it as a
					document of its own.
				</p>
			) : null}

			<fieldset className="mt-4 flex flex-col gap-1">
				<legend className="sr-only">Where this file goes</legend>
				{analysis.matches.map((match) => (
					<label
						key={match.documentId}
						className={`flex items-start gap-3 rounded-[var(--radius-md)] px-2 py-2 ${
							match.identical ? "opacity-60" : "cursor-pointer hover:bg-[var(--hover)]"
						}`}
					>
						<input
							type="radio"
							name="import-choice"
							disabled={match.identical}
							checked={choice.kind === "version" && choice.documentId === match.documentId}
							onChange={() => setChoice({ kind: "version", documentId: match.documentId })}
							className="mt-1 h-4 w-4 accent-[var(--accent)]"
						/>
						<span className="min-w-0">
							<span className="block truncate">New version of {match.title}</span>
							<span className="block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{match.clientName ?? "Not linked to a client"}. {reasonOf(match)}
							</span>
						</span>
					</label>
				))}
				<label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] px-2 py-2 hover:bg-[var(--hover)]">
					<input
						type="radio"
						name="import-choice"
						checked={choice.kind === "new"}
						onChange={() => setChoice({ kind: "new" })}
						className="mt-1 h-4 w-4 accent-[var(--accent)]"
					/>
					<span>A new document</span>
				</label>
			</fieldset>

			{choice.kind === "new" ? (
				<div className="mt-3 flex flex-col gap-4 pl-9">
					{clientId || projectId ? null : <DocumentOwnerFields value={owner} onChange={setOwner} disabled={busy} />}
					<Field label="Title" value={title} onChange={setTitle} />
				</div>
			) : null}

			{error ? (
				<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
					<p data-selectable className="text-[length:var(--text-sm)] text-[var(--risk)]">
						{error}
					</p>
				</div>
			) : null}

			<div className="mt-6 flex justify-end gap-2">
				<Button onClick={cancelAll}>Cancel</Button>
				{items.length > 1 ? <Button onClick={skip}>Skip this file</Button> : null}
				<Button variant="primary" disabled={busy} onClick={() => void confirm()}>
					{busy ? "Saving" : choice.kind === "version" ? "Add as version" : "Import"}
				</Button>
			</div>
		</Dialog>
	);
}
