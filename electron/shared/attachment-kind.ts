/**
 * What an attachment is, judged from its name and declared type. Both the
 * reader (for the icon) and the main process (for what may be opened) use it,
 * so the two cannot disagree about a file.
 */
export type AttachmentKind =
	| "pdf"
	| "image"
	| "document"
	| "sheet"
	| "slides"
	| "archive"
	| "audio"
	| "video"
	| "calendar"
	| "code"
	| "other";

const BY_EXTENSION: Record<string, AttachmentKind> = {
	pdf: "pdf",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	bmp: "image",
	svg: "image",
	heic: "image",
	doc: "document",
	docx: "document",
	odt: "document",
	rtf: "document",
	txt: "document",
	md: "document",
	xls: "sheet",
	xlsx: "sheet",
	ods: "sheet",
	csv: "sheet",
	ppt: "slides",
	pptx: "slides",
	odp: "slides",
	key: "slides",
	zip: "archive",
	rar: "archive",
	"7z": "archive",
	tar: "archive",
	gz: "archive",
	mp3: "audio",
	wav: "audio",
	m4a: "audio",
	ogg: "audio",
	mp4: "video",
	mov: "video",
	mkv: "video",
	avi: "video",
	webm: "video",
	ics: "calendar",
	json: "code",
	xml: "code",
	html: "code",
	htm: "code",
	js: "code",
	ts: "code",
};

function extensionOf(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function attachmentKind(filename: string, mimeType: string): AttachmentKind {
	const byName = BY_EXTENSION[extensionOf(filename)];
	if (byName) return byName;
	if (mimeType === "application/pdf") return "pdf";
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("audio/")) return "audio";
	if (mimeType.startsWith("video/")) return "video";
	if (mimeType === "text/calendar") return "calendar";
	return "other";
}

/**
 * Types that may be handed to the operating system to open. A short list on
 * purpose: formats that carry macros, scripts or a browser engine (svg, html,
 * rtf, the legacy Office formats) and anything executable are left out, and
 * they stay reachable through "Show in folder".
 */
const OPENABLE = new Set([
	"pdf",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"docx",
	"xlsx",
	"pptx",
	"odt",
	"ods",
	"odp",
	"txt",
	"csv",
	"mp3",
	"wav",
	"m4a",
	"mp4",
	"mov",
]);

export function isOpenableAttachment(filename: string): boolean {
	return OPENABLE.has(extensionOf(filename));
}
