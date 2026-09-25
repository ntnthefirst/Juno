import type { ProjectAsset } from "@shared/types";
import { Icon } from "../../components/Icon";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { ASSET_ICONS, assetImageUrl, formatBytes, pathTail } from "./format";

type AssetListProps = {
	assets: ProjectAsset[];
	/** The one drawn on the project's card. Marked, and offered to be changed. */
	coverAssetId: string | null;
	/** Off draws every file as a row with an icon, images included. */
	previews: boolean;
	onOpen: (asset: ProjectAsset) => void;
	onReveal: (asset: ProjectAsset) => void;
	onSetCover: (asset: ProjectAsset | null) => void;
	onRemove: (asset: ProjectAsset) => void;
};

function menuFor(
	asset: ProjectAsset,
	isCover: boolean,
	props: Pick<AssetListProps, "onOpen" | "onReveal" | "onSetCover" | "onRemove">,
): MenuItem[] {
	return [
		{ id: "open", label: "Open", icon: "external", onSelect: () => props.onOpen(asset) },
		{ id: "reveal", label: "Show in folder", icon: "folder-open", onSelect: () => props.onReveal(asset) },
		{
			id: "cover",
			label: isCover ? "Stop using as the cover" : "Use as the cover",
			icon: "star",
			disabled: asset.kind !== "image",
			separatorBefore: true,
			onSelect: () => props.onSetCover(isCover ? null : asset),
		},
		{
			id: "remove",
			label: "Remove",
			icon: "remove",
			danger: true,
			separatorBefore: true,
			onSelect: () => props.onRemove(asset),
		},
	];
}

/**
 * A project's files.
 *
 * Images are tiles and everything else is a row, because a thumbnail of a zip
 * is a grey square with a word on it and a list reads better. The two sit in
 * the same component so the ordering is one list rather than two that disagree.
 *
 * A file whose bytes are gone says so on the tile. That is the cost of a linked
 * file and the interface should not hide it: the alternative is a blank square
 * that a person clicks three times before working out what happened.
 */
export function AssetList({
	assets,
	coverAssetId,
	previews,
	onOpen,
	onReveal,
	onSetCover,
	onRemove,
}: AssetListProps) {
	const handlers = { onOpen, onReveal, onSetCover, onRemove };
	const images = previews ? assets.filter((asset) => asset.kind === "image" && asset.exists) : [];
	const rest = assets.filter((asset) => !images.includes(asset));

	return (
		<div className="flex flex-col gap-4">
			{images.length > 0 ? (
				<ul
					className="grid gap-3"
					style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
				>
					{images.map((asset) => {
						const isCover = asset.id === coverAssetId;
						return (
							<li
								key={asset.id}
								className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]"
							>
								<button
									type="button"
									onClick={() => onOpen(asset)}
									className="block w-full"
									title={`Open ${asset.fileName}`}
								>
									<img
										src={assetImageUrl(asset.id)}
										alt={asset.caption ?? asset.fileName}
										className="h-[110px] w-full bg-[var(--sunken)] object-cover"
									/>
								</button>
								<div className="flex items-center gap-1 px-2 py-1.5">
									<span className="min-w-0 flex-1 truncate text-[length:var(--text-micro)]">
										{asset.fileName}
									</span>
									{isCover ? (
										<span className="flex-none text-[var(--seal)]" title="The project's cover">
											<Icon name="star" size={13} />
										</span>
									) : null}
									<MenuButton
										items={menuFor(asset, isCover, handlers)}
										ariaLabel={`Actions for ${asset.fileName}`}
									/>
								</div>
							</li>
						);
					})}
				</ul>
			) : null}

			{rest.length > 0 ? (
				<ul className="flex flex-col">
					{rest.map((asset) => {
						const isCover = asset.id === coverAssetId;
						return (
							<li
								key={asset.id}
								className="flex items-center gap-3 border-b border-[var(--line)] px-2"
								style={{ height: "var(--row-height)" }}
							>
								<span className="flex-none text-[var(--ink-faint)]">
									<Icon name={ASSET_ICONS[asset.kind]} />
								</span>
								<button
									type="button"
									onClick={() => onOpen(asset)}
									className="min-w-0 flex-1 truncate text-left text-[length:var(--text-dense)]"
								>
									{asset.fileName}
								</button>
								{asset.storage === "linked" ? (
									<span
										className="hidden flex-none truncate text-[length:var(--text-micro)] text-[var(--ink-muted)] sm:block"
										title={asset.absolutePath}
									>
										{pathTail(asset.absolutePath)}
									</span>
								) : null}
								{!asset.exists ? (
									<span className="flex-none text-[length:var(--text-micro)] text-[var(--risk)]">
										Missing
									</span>
								) : null}
								<span className="tabular flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
									{formatBytes(asset.byteSize)}
								</span>
								<MenuButton
									items={menuFor(asset, isCover, handlers)}
									ariaLabel={`Actions for ${asset.fileName}`}
								/>
							</li>
						);
					})}
				</ul>
			) : null}
		</div>
	);
}
