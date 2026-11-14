import type { DocumentRecord } from "@shared/types";
import { isPdfFile } from "../../lib/file-type";

/**
 * The flows a document's menu starts, shared by the explorer and the client
 * and project Documents tabs so the two cannot drift: the same sentence after
 * a conversion, and signing that converts first when the newest version is
 * not a PDF (decision 77).
 */

/** Whether signing has to convert first: the newest version is not a PDF. */
export function needsConversion(record: { latestVersion: { fileName: string | null; mediaType: string } | null }): boolean {
	const latest = record.latestVersion;
	return !latest || !isPdfFile(latest.fileName, latest.mediaType);
}

/** What the person is told once a file has become a PDF, by Word or by Juno. */
export function convertedSentence(via: "word" | "juno"): string {
	return via === "juno"
		? "Converted by Juno, because Word is not installed here. The layout may differ from the original."
		: "Converted to PDF through Word.";
}

/** Converts the newest version to a PDF, kept as a new version, and says how. */
export async function convertToPdf(record: DocumentRecord): Promise<{ record: DocumentRecord; notice: string }> {
	const result = await window.juno.documents.convertPdf(record.id);
	return { record: result.document, notice: convertedSentence(result.via) };
}
