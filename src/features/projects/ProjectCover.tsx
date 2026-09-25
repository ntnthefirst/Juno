import { useState } from "react";
import { assetImageUrl } from "./format";

type ProjectCoverProps = {
	/** Null draws the placeholder rather than an empty box. */
	assetId: string | null;
	/** Used for the initials on the placeholder, and for the alternative text. */
	name: string;
	/** Tailwind classes for the box. The image fills whatever it is given. */
	className?: string;
	/** Smaller placeholder lettering for a thumbnail in a row. */
	compact?: boolean;
};

/** Two letters from the first two words, or the first two of one word. */
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
	return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

/**
 * A project's image, or something honest in its place.
 *
 * The placeholder is initials on the sunken surface rather than a grey
 * rectangle or a generic picture glyph: a wall of identical grey tiles reads as
 * a screen that failed to load, and initials at least tell the tiles apart.
 *
 * The image is served from app://asset, which returns bytes only for a file
 * that is an image it is willing to decode. Anything else is a 404, and the
 * error handler below falls back to the placeholder, so a file that stopped
 * being there is a tile with letters on it rather than a broken picture.
 */
export function ProjectCover({ assetId, name, className, compact = false }: ProjectCoverProps) {
	const [failed, setFailed] = useState(false);
	const box = `flex items-center justify-center overflow-hidden bg-[var(--sunken)] ${className ?? ""}`;

	if (!assetId || failed) {
		return (
			<div className={box} aria-hidden>
				<span
					className={[
						"font-[var(--weight-semibold)] tracking-[0.04em] text-[var(--ink-faint)]",
						compact ? "text-[length:var(--text-sm)]" : "text-[length:var(--text-h3)]",
					].join(" ")}
				>
					{initials(name)}
				</span>
			</div>
		);
	}

	return (
		<div className={box}>
			<img
				src={assetImageUrl(assetId)}
				alt={`Cover image for ${name}`}
				onError={() => setFailed(true)}
				className="h-full w-full object-cover"
			/>
		</div>
	);
}
