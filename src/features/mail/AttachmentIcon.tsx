import { attachmentKind, type AttachmentKind } from "@shared/attachment-kind";
import { Icon, type IconName } from "../../components/Icon";

type AttachmentIconProps = {
	filename: string;
	mimeType: string;
};

const GLYPH: Record<AttachmentKind, IconName> = {
	pdf: "documents",
	image: "image",
	document: "documents",
	sheet: "file-sheet",
	slides: "file-slides",
	archive: "archive",
	audio: "file-audio",
	video: "file-video",
	calendar: "calendar",
	code: "view-code",
	other: "file",
};

// One colour per family, from the status tokens, so a list of attachments can
// be scanned by type. Everything without a family stays muted.
const TONE: Partial<Record<AttachmentKind, string>> = {
	pdf: "text-[var(--risk)]",
	document: "text-[var(--accent)]",
	sheet: "text-[var(--ok)]",
	slides: "text-[var(--warn)]",
};

export function AttachmentIcon({ filename, mimeType }: AttachmentIconProps) {
	const kind = attachmentKind(filename, mimeType);
	return (
		<span className={`shrink-0 ${TONE[kind] ?? "text-[var(--ink-muted)]"}`}>
			<Icon name={GLYPH[kind]} size={18} />
		</span>
	);
}
