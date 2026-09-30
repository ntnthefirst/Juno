import type { ProjectAssetKind, ProjectLinkKind } from "@shared/types";
import type { IconName } from "../../components/Icon";
import { ASSET_ORIGIN } from "@shared/types";

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
export function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

/** Cents to "1.250,00", in the Belgian format the rest of the app uses. */
export function formatCents(cents: number | null): string {
	if (cents === null) return "";
	return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const UNITS = ["B", "kB", "MB", "GB", "TB"];

/**
 * Decimal units rather than binary, because a file manager on every platform
 * this runs on says 1,2 MB for the same file and disagreeing with it helps
 * nobody.
 */
export function formatBytes(bytes: number | null): string {
	if (bytes === null) return "";
	if (bytes < 1000) return `${bytes} B`;
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < UNITS.length - 1) {
		value /= 1000;
		unit += 1;
	}
	return `${value.toFixed(value < 10 ? 1 : 0).replace(".", ",")} ${UNITS[unit]}`;
}

export const LINK_ICONS: Record<ProjectLinkKind, IconName> = {
	github: "repo",
	figma: "figma",
	website: "web",
	design: "design",
	docs: "docs",
	folder: "folder-open",
	other: "link",
};

export const LINK_LABELS: Record<ProjectLinkKind, string> = {
	github: "Repository",
	figma: "Figma",
	website: "Website",
	design: "Design",
	docs: "Docs",
	folder: "Folder",
	other: "Link",
};

export const ASSET_ICONS: Record<ProjectAssetKind, IconName> = {
	image: "image",
	pdf: "documents",
	video: "play",
	audio: "play",
	archive: "archive",
	file: "documents",
};

/**
 * Where a thumbnail comes from. A separate origin that serves image bytes and
 * nothing else, so the renderer never holds a path to a file on disk. The id is
 * enough: the main process resolves it.
 */
export function assetImageUrl(assetId: string): string {
	return `${ASSET_ORIGIN}/file/${assetId}`;
}

/**
 * The tail of a path, for a row too narrow to hold the whole thing. Whichever
 * separator the path already uses is kept: a Windows path with forward slashes
 * in it reads as a mistake.
 */
export function pathTail(path: string, segments = 2): string {
	const separator = path.includes("\\") ? "\\" : "/";
	const parts = path.split(/[\\/]/).filter(Boolean);
	if (parts.length <= segments) return path;
	return `...${separator}${parts.slice(-segments).join(separator)}`;
}
