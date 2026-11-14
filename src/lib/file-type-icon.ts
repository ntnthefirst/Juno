/**
 * Which bundled file-type icon a file gets, from its name and declared type.
 * Pure, so it can be tested without the images. The names are the files in
 * `assets/file-types/`, and `components/FileTypeIcon.tsx` holds the imports.
 */
export const FILE_TYPE_ICON_KEYS = [
	"7z",
	"avi",
	"blank",
	"bmp",
	"csv",
	"doc",
	"docx",
	"gif",
	"heic",
	"html",
	"ics",
	"image",
	"jpeg",
	"jpg",
	"json",
	"key",
	"m4a",
	"md",
	"mkv",
	"mov",
	"mp3",
	"mp4",
	"ods",
	"odt",
	"ogg",
	"pages",
	"pdf",
	"png",
	"ppt",
	"pptx",
	"rar",
	"rtf",
	"svg",
	"txt",
	"wav",
	"webm",
	"webp",
	"xls",
	"xlsx",
	"xml",
	"zip",
] as const;

export type FileTypeIconKey = (typeof FILE_TYPE_ICON_KEYS)[number];

const OWN = new Set<string>(FILE_TYPE_ICON_KEYS.filter((key) => key !== "blank" && key !== "image"));

/**
 * Extensions the set has no icon of its own for, sent to the nearest family.
 * The set draws no Numbers, OpenDocument presentation or message icon, so
 * those take a neighbour or the blank page.
 */
const ALIASES: Record<string, FileTypeIconKey> = {
	dot: "doc",
	dotx: "docx",
	docm: "docx",
	xlsm: "xlsx",
	xlt: "xls",
	xltx: "xlsx",
	numbers: "ods",
	tsv: "csv",
	pps: "ppt",
	ppsx: "pptx",
	pptm: "pptx",
	odp: "ppt",
	htm: "html",
	tif: "image",
	tiff: "image",
	avif: "image",
	ico: "image",
	raw: "image",
	tar: "zip",
	gz: "zip",
	tgz: "zip",
	bz2: "zip",
	xz: "zip",
	eml: "blank",
	msg: "blank",
	flac: "m4a",
	aac: "m4a",
	m4v: "mp4",
	mpg: "mp4",
	mpeg: "mp4",
	wmv: "avi",
};

/** Lower case, no dot. Empty when the name has no extension. */
export function iconExtension(fileName: string | null): string {
	if (!fileName) return "";
	const dot = fileName.lastIndexOf(".");
	return dot <= 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export function fileTypeIconKey(fileName: string | null, mediaType = ""): FileTypeIconKey {
	const extension = iconExtension(fileName);
	if (OWN.has(extension)) return extension as FileTypeIconKey;
	const alias = ALIASES[extension];
	if (alias) return alias;
	const type = mediaType.toLowerCase();
	if (type === "application/pdf") return "pdf";
	if (type === "image/svg+xml") return "svg";
	if (type.startsWith("image/")) return "image";
	if (type.startsWith("audio/")) return "mp3";
	if (type.startsWith("video/")) return "mp4";
	if (type === "text/calendar") return "ics";
	if (type === "text/csv") return "csv";
	if (type === "text/markdown") return "md";
	if (type === "text/html") return "html";
	if (type === "application/json") return "json";
	if (type === "text/xml" || type === "application/xml") return "xml";
	if (type.startsWith("text/")) return "txt";
	if (type === "application/zip") return "zip";
	return "blank";
}
