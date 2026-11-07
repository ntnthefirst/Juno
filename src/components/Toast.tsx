import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isFailureMessage } from "@/lib/errors";
import { Button } from "./Button";
import { Icon } from "./Icon";

const DISMISS_AFTER_MS = 8000;

type ToastProps = {
	message: string;
	/** Done draws a tick, error a warning. Left out, a message that came from a failure is an error. */
	tone?: "done" | "error";
	actionLabel?: string;
	onAction?: () => void;
	onDismiss: () => void;
};

/** Floats above the page, so it earns a surface and a shadow. */
export function Toast({ message, tone, actionLabel, onAction, onDismiss }: ToastProps) {
	const failed = (tone ?? (isFailureMessage(message) ? "error" : "done")) === "error";
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
			data-popover-root
			className="animate-lift fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] py-3 pl-4 pr-3"
			style={{ boxShadow: "var(--shadow-popover)" }}
		>
			<Icon
				name={failed ? "warning" : "check"}
				size={16}
				className={`flex-none ${failed ? "text-[var(--risk)]" : "text-[var(--ok)]"}`}
			/>
			<span className="text-base">{message}</span>
			{actionLabel && onAction ? (
				<Button size="dense" onClick={act}>
					<span className="text-[var(--accent)]">{actionLabel}</span>
				</Button>
			) : null}
		</div>,
		document.body,
	);
}
