import { useEffect, useRef, useState } from "react";
import { FaceSmileIcon } from "@heroicons/react/24/outline";
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ACTIVE } from "./toolbar-styles";

type EmojiPickerProps = {
	disabled?: boolean;
	onInsert: (emoji: string) => void;
};

// A small, deliberately generic set. This is a compose toolbar, not a picker
// for every emoji ever drawn, so it stays to the ones a business email
// actually uses.
const EMOJI = [
	"🙂", "😀", "😄", "😉", "😊", "😍", "😘", "😎",
	"🤔", "😅", "😢", "😮", "🙌", "👏", "👍", "👎",
	"🙏", "💪", "🎉", "✅", "❌", "⭐", "🔥", "❤️",
	"💡", "📌", "📎", "📅", "⏰", "📞", "✉️", "☑️",
];

/**
 * One flat grid rather than search or categories: the set above is short
 * enough that scanning it is faster than typing to filter it.
 */
export function EmojiPicker({ disabled = false, onInsert }: EmojiPickerProps) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onPointerDown(event: MouseEvent) {
			if (rootRef.current?.contains(event.target as Node)) return;
			setOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open]);

	return (
		<div ref={rootRef} className="relative">
			<button
				type="button"
				disabled={disabled}
				aria-label="Insert an emoji"
				title="Insert an emoji"
				onClick={() => setOpen((value) => !value)}
				className={`${TOOLBAR_BUTTON}${open ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
			>
				<FaceSmileIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
			</button>
			{open ? (
				<div
					role="menu"
					aria-label="Insert an emoji"
					className="absolute top-[calc(100%+4px)] left-0 z-10 grid w-[248px] grid-cols-8 gap-1 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-2"
					style={{ boxShadow: "var(--shadow-popover)" }}
				>
					{EMOJI.map((emoji) => (
						<button
							key={emoji}
							type="button"
							role="menuitem"
							onClick={() => {
								onInsert(emoji);
								setOpen(false);
							}}
							className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[length:var(--text-base)] hover:bg-[var(--hover)]"
						>
							{emoji}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
