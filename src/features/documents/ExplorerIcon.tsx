import type { DocumentTreeNode } from "@shared/types";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { Avatar } from "../../components/Avatar";
import { Icon, type IconName } from "../../components/Icon";
import type { ExplorerItem } from "./explorer-items";

type ExplorerIconProps = {
	item: ExplorerItem;
	/** Square, in pixels. */
	size?: number;
};

const NODE_ICONS: Record<Exclude<DocumentTreeNode["kind"], "client" | "project">, IconName> = {
	folder: "folder",
	unfiled: "inbox",
	templates: "templates",
};

/**
 * What a row or a tile is, at a glance: a client or a project by its avatar,
 * the same tint it has everywhere else, a folder by a folder, and a file by
 * the icon people know for its type, the one the mail reader uses for an
 * attachment, so a Word file looks the same in both places.
 */
export function ExplorerIcon({ item, size = 18 }: ExplorerIconProps) {
	if (item.kind === "node") {
		const { node } = item;
		if (node.kind === "client" || node.kind === "project") return <Avatar name={node.name} size={size + 2} shape="square" />;
		return (
			<span className={`flex-none ${node.kind === "folder" ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"}`}>
				<Icon name={NODE_ICONS[node.kind]} size={size} />
			</span>
		);
	}
	if (item.kind === "template") {
		return (
			<span className="flex-none text-[var(--accent)]">
				<Icon name="templates" size={size} />
			</span>
		);
	}
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
