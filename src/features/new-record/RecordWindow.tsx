import { useEffect, type FormEvent, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { overlayGutter } from "../../lib/platform";

type RecordWindowProps = {
	title: string;
	saveLabel: string;
	busy: boolean;
	/** What went wrong with the save, in the two clauses `writing.md` asks for. */
	error: string | null;
	onSubmit: () => void;
	/**
	 * Something was saved from inside the form before the window closes, such as
	 * a client made from the client picker, so the screen behind reads again
	 * even when the record itself is cancelled.
	 */
	madeAlongside?: boolean;
	children: ReactNode;
};

/** Cancel is the one way out that saves nothing of its own. */
export function cancelNewRecord(madeAlongside = false): void {
	void window.juno.window.closeNewRecord(madeAlongside);
}

/**
 * The frame every new-record window shares: a title bar, the fields, and a
 * footer with Cancel and the save button (design frames 58:4449, 90:9301,
 * 90:9368 and 90:9426). The window is modal and fixed, so the form scrolls
 * inside it rather than the window growing.
 */
export function RecordWindow({ title, saveLabel, busy, error, onSubmit, madeAlongside = false, children }: RecordWindowProps) {
	// Escape closes a modal window, and this one is one.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented) cancelNewRecord(madeAlongside);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [madeAlongside]);

	function submit(event: FormEvent) {
		event.preventDefault();
		if (!busy) onSubmit();
	}

	return (
		<form onSubmit={submit} noValidate className="flex h-full flex-col bg-[var(--paper)]">
			<header
				className="drag-region flex flex-none items-center border-b border-[var(--line)]"
				style={{
					height: "var(--titlebar-height)",
					paddingLeft: "var(--space-4)",
					paddingRight: overlayGutter.right,
				}}
			>
				<h1 className="text-base font-[var(--weight-semibold)]">{title}</h1>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-4">
				<div className="flex flex-col gap-5 [&_label>span[aria-hidden]]:hidden [&_select]:border-[var(--line-strong)] [&_select]:bg-[var(--surface)]">
					{children}
				</div>
				{error ? (
					<div role="alert" className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p data-selectable className="text-sm text-[var(--risk)]">
							{error}
						</p>
					</div>
				) : null}
			</div>

			<footer className="flex flex-none items-center justify-end gap-2 border-t border-[var(--line)] px-8 py-4">
				<Button onClick={() => cancelNewRecord(madeAlongside)}>Cancel</Button>
				<Button type="submit" variant="primary" disabled={busy}>
					{busy ? "Saving" : saveLabel}
				</Button>
			</footer>
		</form>
	);
}
