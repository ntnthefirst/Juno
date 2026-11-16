import { FileTypeIcon } from "../../components/FileTypeIcon";
import { Icon } from "../../components/Icon";
import type { ExplorerItem } from "./explorer-items";

type ExplorerIconProps = {
	item: ExplorerItem;
	/** Square, in pixels. */
	size?: number;
};

/**
 * What a row or a tile is, at a glance: a client or a project by its avatar,
 * the same tint it has everywhere else, a folder by a folder, and a file by
 * the icon people know for its type, the one the mail reader uses for an
 * attachment, so a Word file looks the same in both places.
 */
export function ExplorerIcon({ item, size = 18 }: ExplorerIconProps) {
	const { record } = item;
	if (record.sourceKind === "page") {
		return (
			<span className="flex-none text-[var(--accent)]">
				<Icon name="note" size={size} />
			</span>
		);
	}
	if (!record.latestVersion) {
		return (
			<span className="flex-none text-[var(--ink-muted)]">
				<Icon name="file" size={size} />
			</span>
		);
	}
	return (
		<FileTypeIcon
			filename={record.latestVersion.fileName ?? record.title}
			mimeType={record.latestVersion.mediaType}
			size={size}
		/>
	);
}
