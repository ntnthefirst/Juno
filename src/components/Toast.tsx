import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { announce } from "@/lib/announce";
import { isFailureMessage } from "@/lib/errors";
import { COMBOS, matchesCombo } from "@/lib/shortcuts";
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

	// A new message shown in the same place starts its own countdown, so a
	// second "Deleted" with its own Undo is not taken away early with the first.
	useEffect(() => {
		const id = window.setTimeout(() => dismiss.current(), DISMISS_AFTER_MS);
		timer.current = id;
		return () => window.clearTimeout(id);
	}, [message, actionLabel]);

	// Read out through the window's one live region, which is there before the toast is.
	const offered = actionLabel && onAction ? actionLabel : null;
	useEffect(() => {
		announce(offered ? `${message} ${offered} is offered beside it.` : message);
	}, [message, offered]);

	function act() {
		if (timer.current !== null) window.clearTimeout(timer.current);
		onAction?.();
	}

	// Ctrl or Cmd Z takes an Undo the toast offers, so it is not only at the far end of the tab
	// order. A field keeps its own undo, and nothing fires under a question that is waiting.
	const latestAct = useRef(act);
	useEffect(() => {
		latestAct.current = act;
	});
	const undoable = actionLabel === "Undo" && onAction !== undefined;
	useEffect(() => {
		if (!undoable) return;
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented || !matchesCombo(event, COMBOS.undo)) return;
			const target = event.target;
			if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
			if (document.querySelector("[role='dialog']")) return;
			event.preventDefault();
			latestAct.current();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [undoable]);

	return createPortal(
		<div
			data-toast
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
