import { useEffect, useRef, useState } from "react";
import type { ComposeBlock, ComposeBlockKind } from "@shared/types";
import { CheckIcon } from "@heroicons/react/24/outline";
import { Tooltip } from "../../../components/Tooltip";
import { TOOLBAR_BUTTON } from "../../../components/toolbar-styles";
import { contextMenuFor } from "../../../lib/native-menu";
import { BlockText } from "./BlockText";
import { BlockIcon } from "./BlockIcons";
import { KIND_LABEL, RULE_SHORT } from "./block-text";

/** Where the manage screen opens: on a block, on a new one of a kind, or on the list. */
export type ManageTarget = { blockId: string } | { newKind: ComposeBlockKind } | null;

type BlockMenuProps = {
	kind: ComposeBlockKind;
	/** The blocks of this kind, in the owner's order. */
	blocks: ComposeBlock[];
	/** The block whose text is in the message now, or null. */
	activeId: string | null;
	/** A block to put in, or null for "No intro" and "No outro". */
	onPick: (blockId: string | null) => void;
	/** Left out where there is no manage screen to open: the menu then only picks. */
	onManage?: (target: ManageTarget) => void;
};

const BUTTON = TOOLBAR_BUTTON.replace("h-8 w-8", "h-9 w-9");

/**
 * One of the two buttons at the start of the composer toolbar. A click lists the
 * blocks of its kind under it, and a right click is the way to the manage
 * screen. Choosing a row puts that block at the start or end of the message
 * and nothing else: it never sends anything.
 */
export function BlockMenu({ kind, blocks, activeId, onPick, onManage }: BlockMenuProps) {
	const label = KIND_LABEL[kind];
	const noun = label.toLowerCase();
	const root = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		function onPointerDown(event: MouseEvent) {
			if (root.current?.contains(event.target as Node)) return;
			setOpen(false);
		}
		function onKey(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			// The composer closes on Escape too, so this one is the menu's alone.
			event.stopPropagation();
			setOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [open]);

	const shown = blocks.find((block) => block.id === (hovered ?? activeId)) ?? null;

	function choose(blockId: string | null) {
		setOpen(false);
		setHovered(null);
		onPick(blockId);
	}

	const inUse = blocks.find((block) => block.id === activeId) ?? blocks[0] ?? null;
	// The right-click menu is the platform's, built in the main process
	// (decision 59). This says what its three items do.
	const manageMenu = contextMenuFor(
		{ kind: "block", id: kind },
		{
			"edit-block": () => onManage?.(inUse ? { blockId: inUse.id } : { newKind: kind }),
			"new-block": () => onManage?.({ newKind: kind }),
			"manage-blocks": () => onManage?.(null),
		},
	);

	return (
		<div ref={root} className="relative" data-popover-root>
			<Tooltip label={label} side="bottom">
				<button
					type="button"
					aria-label={label}
					aria-haspopup="menu"
					aria-expanded={open}
					onClick={() => setOpen((current) => !current)}
					onContextMenu={onManage ? manageMenu : undefined}
					className={`${BUTTON}${open ? " bg-[var(--accent-soft)]! text-[var(--accent)]!" : ""}`}
				>
					<BlockIcon kind={kind} />
				</button>
			</Tooltip>

			{open ? (
				<div
					role="menu"
					aria-label={label}
					className="animate-scale absolute top-[calc(100%+4px)] left-0 z-30 w-[276px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-1.5"
					style={{ boxShadow: "var(--shadow-popover)" }}
				>
					<p className="px-2.5 pt-1.5 pb-1 text-overline text-[var(--ink-muted)] uppercase">{label}</p>
					{blocks.map((block) => (
						<button
							key={block.id}
							type="button"
							role="menuitem"
							onClick={() => choose(block.id)}
							onMouseEnter={() => setHovered(block.id)}
							onMouseLeave={() => setHovered(null)}
							onFocus={() => setHovered(block.id)}
							onBlur={() => setHovered(null)}
							className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] pr-2.5 pl-2 text-left text-base transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] focus-visible:bg-[var(--accent-soft)]"
						>
							<span className="flex w-4 flex-none justify-center text-[var(--accent)]">
								{block.id === activeId ? <CheckIcon width={14} height={14} strokeWidth={2.2} aria-hidden /> : null}
							</span>
							<span className="min-w-0 flex-1 truncate">{block.name}</span>
							<span className="flex-none text-sm text-[var(--ink-muted)]">{RULE_SHORT[block.rule]}</span>
						</button>
					))}
					{blocks.length > 0 ? <div className="mx-1 my-1 h-px bg-[var(--line)]" /> : null}
					<button
						type="button"
						role="menuitem"
						onClick={() => choose(null)}
						className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] pr-2.5 pl-2 text-left text-base transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] focus-visible:bg-[var(--accent-soft)]"
					>
						<span className="w-4 flex-none" />
						No {noun}
					</button>

					{shown ? (
						<div className="mt-1.5 rounded-[var(--radius-md)] bg-[var(--sunken)] px-3 py-2.5">
							<p className="text-overline text-[var(--ink-muted)] uppercase">Preview</p>
							<p className="mt-1 text-base">
								<BlockText body={shown.body} />
							</p>
						</div>
					) : null}
					{onManage ? (
						<p className="px-2.5 pt-2 pb-1 text-micro text-[var(--ink-muted)]">Right click the icon to manage</p>
					) : null}
				</div>
			) : null}

		</div>
	);
}
