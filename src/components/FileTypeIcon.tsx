import { fileTypeIconKey, type FileTypeIconKey } from "../lib/file-type-icon";
import sevenZip from "../assets/file-types/7z.svg";
import avi from "../assets/file-types/avi.svg";
import blank from "../assets/file-types/blank.svg";
import bmp from "../assets/file-types/bmp.svg";
import csv from "../assets/file-types/csv.svg";
import doc from "../assets/file-types/doc.svg";
import docx from "../assets/file-types/docx.svg";
import gif from "../assets/file-types/gif.svg";
import heic from "../assets/file-types/heic.svg";
import html from "../assets/file-types/html.svg";
import ics from "../assets/file-types/ics.svg";
import image from "../assets/file-types/image.svg";
import jpeg from "../assets/file-types/jpeg.svg";
import jpg from "../assets/file-types/jpg.svg";
import json from "../assets/file-types/json.svg";
import key from "../assets/file-types/key.svg";
import m4a from "../assets/file-types/m4a.svg";
import md from "../assets/file-types/md.svg";
import mkv from "../assets/file-types/mkv.svg";
import mov from "../assets/file-types/mov.svg";
import mp3 from "../assets/file-types/mp3.svg";
import mp4 from "../assets/file-types/mp4.svg";
import ods from "../assets/file-types/ods.svg";
import odt from "../assets/file-types/odt.svg";
import ogg from "../assets/file-types/ogg.svg";
import pages from "../assets/file-types/pages.svg";
import pdf from "../assets/file-types/pdf.svg";
import png from "../assets/file-types/png.svg";
import ppt from "../assets/file-types/ppt.svg";
import pptx from "../assets/file-types/pptx.svg";
import rar from "../assets/file-types/rar.svg";
import rtf from "../assets/file-types/rtf.svg";
import svg from "../assets/file-types/svg.svg";
import txt from "../assets/file-types/txt.svg";
import wav from "../assets/file-types/wav.svg";
import webm from "../assets/file-types/webm.svg";
import webp from "../assets/file-types/webp.svg";
import xls from "../assets/file-types/xls.svg";
import xlsx from "../assets/file-types/xlsx.svg";
import xml from "../assets/file-types/xml.svg";
import zip from "../assets/file-types/zip.svg";

type FileTypeIconProps = {
	filename: string | null;
	mimeType?: string;
	/** Height in pixels. The pages are drawn portrait inside a square of this size. */
	size?: number;
};

/**
 * The icons are another project's artwork, bundled with their source in
 * `assets/file-types/SOURCES.md`. They keep their own colours in both themes
 * (styling.md section 2), so they are images and never go through Icon.tsx.
 */
const ICONS: Record<FileTypeIconKey, string> = {
	"7z": sevenZip,
	avi,
	blank,
	bmp,
	csv,
	doc,
	docx,
	gif,
	heic,
	html,
	ics,
	image,
	jpeg,
	jpg,
	json,
	key,
	m4a,
	md,
	mkv,
	mov,
	mp3,
	mp4,
	ods,
	odt,
	ogg,
	pages,
	pdf,
	png,
	ppt,
	pptx,
	rar,
	rtf,
	svg,
	txt,
	wav,
	webm,
	webp,
	xls,
	xlsx,
	xml,
	zip,
};

/** What a file is, by the icon people know for its type. Decorative: the name beside it says the rest. */
export function FileTypeIcon({ filename, mimeType = "", size = 18 }: FileTypeIconProps) {
	return (
		<span aria-hidden className="flex flex-none items-center justify-center" style={{ width: size, height: size }}>
			<img
				src={ICONS[fileTypeIconKey(filename, mimeType)]}
				alt=""
				draggable={false}
				style={{ height: size, width: "auto", maxWidth: size }}
			/>
		</span>
	);
}
