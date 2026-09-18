import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(", ");

type DialogProps = {
	title: string;
	onClose: () => void;
	children: ReactNode;
	/**
	 * narrow for a confirmation, base for a form, wide for a document preview,
	 * which has to be near A4 proportions to be worth looking at.
	 */
	width?: "narrow" | "base" | "wide";
};

/**
 * A modal earns its surface because it floats: border, radius and a shadow say
 * it is above the page. See brand/BRAND.md section 7.
 */
export function Dialog({ title, onClose, children, width = "base" }: DialogProps) {
	const panel = useRef<HTMLDivElement>(null);
	const labelId = useId();

	// Focus moves in on mount and back to whatever opened the dialog on unmount.
	useEffect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const node = panel.current;
		const first = node?.querySelector<HTMLElement>(FOCUSABLE);
		(first ?? node)?.focus();
		return () => opener?.focus();
	}, []);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const node = panel.current;
			if (!node) return;

			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}

			if (event.key !== "Tab") return;

			const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (items.length === 0) {
				event.preventDefault();
				node.focus();
				return;
			}

			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			const outside = !(active instanceof Node) || !node.contains(active);

			if (event.shiftKey && (active === first || outside)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || outside)) {
				event.preventDefault();
				first.focus();
			}
		}

		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-[var(--ink)]/25 p-8"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelId}
				tabIndex={-1}
				className={`w-full rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] focus:outline-none ${
					width === "narrow"
						? "max-w-[400px]"
						: width === "wide"
							? "max-w-[860px]"
							: "max-w-[560px]"
				}`}
				style={{ boxShadow: "var(--shadow-modal)" }}
			>
				<h2
					id={labelId}
					className="px-6 pt-6 text-[length:var(--text-h3)] font-[var(--weight-semibold)] tracking-[-0.01em]"
				>
					{title}
				</h2>
				<div className="px-6 pb-6">{children}</div>
			</div>
		</div>,
		document.body,
	);
}
