import { useEffect, useRef } from "react";
import { SHORTCUT_GROUPS } from "./shortcuts";

type ShortcutListProps = {
	onClose: () => void;
};

/**
 * Every key the editor answers to, in a card over the toolbar.
 *
 * It floats rather than taking a page, because it is read while working and
 * shut again: nothing in it is a field. A press anywhere outside it closes it,
 * and Escape does too, through the editor's own keyboard.
 */
export function ShortcutList({ onClose }: ShortcutListProps) {
	const card = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const outside = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || card.current?.contains(target)) return;
			// The toolbar button that opened it closes it on its own.
			if (target instanceof Element && target.closest("[data-shortcut-toggle]")) return;
			onClose();
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [onClose]);

	return (
		<div
			ref={card}
			role="region"
			aria-label="Keyboard shortcuts"
			className="absolute right-0 bottom-full mb-2 max-h-[70vh] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-popover)]"
		>
			<h2 className="text-[length:var(--text-sm)] font-[var(--weight-semibold)]">Keyboard shortcuts</h2>
			<div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-3">
				{SHORTCUT_GROUPS.map((group) => (
					<section key={group.title}>
						<h3 className="text-[length:var(--text-micro)] font-[var(--weight-semibold)] tracking-[0.04em] text-[var(--ink-muted)] uppercase">
							{group.title}
						</h3>
						<dl className="mt-1 flex flex-col">
							{group.items.map((item) => (
								<div key={item.label} className="flex h-[24px] items-center gap-2">
									<dt className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--ink)]">{item.label}</dt>
									<dd className="flex-none">
										<kbd className="rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 py-0.5 font-[family-name:var(--font-ui)] text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{item.keys}
										</kbd>
									</dd>
								</div>
							))}
						</dl>
					</section>
				))}
			</div>
		</div>
	);
}
