import { useEffect, useRef, useState } from "react";
import type { ExplorerItem } from "./explorer-items";
import { ExplorerIcon } from "./ExplorerIcon";
import { forgetTilePicture, tilePicture, type TilePicture } from "./tile-picture";

type TileThumbProps = {
	item: ExplorerItem;
	/** Read at once, for a tile that is on screen from the start. */
	eager?: boolean;
};

type Held = { key: string; picture: TilePicture };

/**
 * The picture at the top of a tile. A file's is read when the tile first
 * comes near the screen and never before, and until it arrives (or when there
 * is none) the tile shows the file's icon in the same space, so the grid does
 * not move as pictures land.
 */
export function TileThumb({ item, eager = false }: TileThumbProps) {
	const holder = useRef<HTMLSpanElement>(null);
	const latest = item.kind === "document" && item.record.sourceKind !== "page" ? item.record.latestVersion : null;
	const key = latest ? latest.id : null;
	const [near, setNear] = useState(false);
	const [held, setHeld] = useState<Held | null>(null);

	useEffect(() => {
		const element = holder.current;
		if (!element || key === null) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setNear(true);
			},
			{ rootMargin: "300px 0px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [key]);

	useEffect(() => {
		if ((!near && !eager) || key === null) return;
		let cancelled = false;
		void tilePicture(key, { kind: "version", versionId: key }).then((picture) => {
			if (!cancelled) setHeld({ key, picture });
		});
		return () => {
			cancelled = true;
		};
	}, [near, eager, key]);

	const picture = held && held.key === key ? held.picture : null;

	return (
		<span
			ref={holder}
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--sunken)]"
		>
			{picture ? (
				<img
					src={picture.url}
					alt=""
					draggable={false}
					onError={() => {
						if (key) forgetTilePicture(key);
						setHeld(null);
					}}
					className="animate-fade h-full w-full object-cover object-top"
				/>
			) : (
				<ExplorerIcon item={item} size={36} />
			)}
		</span>
	);
}
