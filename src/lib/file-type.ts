/**
 * What a file is called in a list's Type column, from its name and declared
 * type: "PDF", "Word", "Excel". Short on purpose, because the column is
 * narrow and the icon beside the name already says the family.
 */
const NAMES: Record<string, string> = {
	pdf: "PDF",
	doc: "Word",
	docx: "Word",
	odt: "Text document",
	rtf: "Rich text",
	xls: "Excel",
	xlsx: "Excel",
	ods: "Spreadsheet",
	csv: "CSV",
	ppt: "PowerPoint",
	pptx: "PowerPoint",
	odp: "Presentation",
	pages: "Pages",
	numbers: "Numbers",
	key: "Keynote",
	txt: "Text",
	md: "Markdown",
	json: "JSON",
	xml: "XML",
	html: "HTML",
	htm: "HTML",
	png: "PNG image",
	jpg: "JPEG image",
	jpeg: "JPEG image",
	gif: "GIF image",
	webp: "WebP image",
	bmp: "Bitmap",
	svg: "SVG image",
	heic: "HEIC image",
	avif: "AVIF image",
	ico: "Icon",
	zip: "ZIP archive",
	rar: "RAR archive",
	"7z": "7-Zip archive",
	mp3: "Audio",
	wav: "Audio",
	m4a: "Audio",
	mp4: "Video",
	mov: "Video",
	ics: "Calendar",
	dwg: "Drawing",
	dxf: "Drawing",
};

/** Lower case, no dot. Empty when the name has none, or only starts with one. */
export function extensionOfName(name: string | null): string {
	if (!name) return "";
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileTypeLabel(fileName: string | null, mediaType: string): string {
	const extension = extensionOfName(fileName);
	const named = NAMES[extension];
	if (named) return named;
	if (mediaType === "application/pdf") return "PDF";
	if (mediaType.startsWith("image/")) return "Image";
	if (mediaType.startsWith("text/")) return "Text";
	if (extension) return extension.toUpperCase();
	return "File";
}

/**
 * The name a document is attached to a mail under: its title, with the
 * extension of its newest file, which is what goes out (decision 75). A
 * document with no file yet is still a PDF to be made.
 */
export function attachedNameOf(document: { title: string; latestVersion: { fileName: string | null } | null }): string {
	const extension = extensionOfName(document.latestVersion?.fileName ?? null) || "pdf";
	return `${document.title}.${extension}`;
}

/** Whether a file of this name and type is a PDF, which is what Sign needs. */
export function isPdfFile(fileName: string | null, mediaType: string): boolean {
	return mediaType === "application/pdf" || extensionOfName(fileName) === "pdf";
}
