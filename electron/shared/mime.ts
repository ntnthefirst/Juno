/**
 * The type a file is sent as, from its name. A message carries any kind of
 * file, so the list covers what a small business mails around: office files,
 * pictures, drawings, archives, audio and video. Anything not on it goes as
 * `application/octet-stream`, which every mail client accepts and saves.
 */
const BY_EXTENSION: Record<string, string> = {
	pdf: "application/pdf",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	odt: "application/vnd.oasis.opendocument.text",
	rtf: "application/rtf",
	txt: "text/plain",
	md: "text/markdown",
	csv: "text/csv",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	odp: "application/vnd.oasis.opendocument.presentation",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	heic: "image/heic",
	svg: "image/svg+xml",
	tif: "image/tiff",
	tiff: "image/tiff",
	dwg: "image/vnd.dwg",
	dxf: "image/vnd.dxf",
	zip: "application/zip",
	"7z": "application/x-7z-compressed",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	mp4: "video/mp4",
	mov: "video/quicktime",
	ics: "text/calendar",
	vcf: "text/vcard",
	json: "application/json",
	xml: "application/xml",
	html: "text/html",
};

/** The extension of a name or a path, lowercased, without the dot. Empty when there is none. */
export function extensionOf(name: string): string {
	// Both separators: a name from Windows can arrive with backslashes in it.
	const base = name.split(/[\\/]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function mimeTypeOf(name: string): string {
	return BY_EXTENSION[extensionOf(name)] ?? "application/octet-stream";
}

export function isPdfName(name: string): boolean {
	return extensionOf(name) === "pdf";
}
