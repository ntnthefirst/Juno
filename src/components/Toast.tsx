import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

const DISMISS_AFTER_MS = 8000;

type ToastProps = {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	onDismiss: () => void;
};

/** Floats above the page, so it earns a surface and a shadow. */
export function Toast({ message, actionLabel, onAction, onDismiss }: ToastProps) {
	const timer = useRef<number | null>(null);
	const dismiss = useRef(onDismiss);

	// Kept in a ref so a re-render of the caller does not restart the countdown.
	useEffect(() => {
		dismiss.current = onDismiss;
	}, [onDismiss]);

	useEffect(() => {
		const id = window.setTimeout(() => dismiss.current(), DISMISS_AFTER_MS);
		timer.current = id;
		return () => window.clearTimeout(id);
	}, []);

	function act() {
		if (timer.current !== null) window.clearTimeout(timer.current);
		onAction?.();
	}

	return createPortal(
		<div
			role="status"
			aria-live="polite"
			className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] py-2 pl-4 pr-2"
			style={{ boxShadow: "var(--shadow-popover)" }}
		>
			<span className="text-[length:var(--text-dense)]">{message}</span>
			{actionLabel && onAction ? (
				<Button size="dense" onClick={act}>
					<span className="text-[var(--accent)]">{actionLabel}</span>
				</Button>
			) : null}
		</div>,
		document.body,
	);
}
