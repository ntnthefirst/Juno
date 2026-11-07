import { useCallback, useEffect, useState } from "react";
import type { DesktopPatch, DesktopView } from "@shared/types";
import { acceleratorFromEvent } from "@shared/accelerator";
import { Button } from "../../components/Button";
import { Kbd } from "../../components/Kbd";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

/**
 * Notifications and tray. Windows toasts, the tray icon, the taskbar badge and
 * the shortcut for a new note. Whether closing the window keeps Juno running is
 * the same setting as Settings > MCP > Server, shown here because it is what a
 * person looks for next to the tray.
 */
export function DesktopSection() {
	const [view, setView] = useState<DesktopView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [recording, setRecording] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.desktop
			.get()
			.then((value) => {
				if (!cancelled) setView(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const save = useCallback(async (patch: DesktopPatch) => {
		setBusy(true);
		setError(null);
		try {
			setView(await window.juno.desktop.update(patch));
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}, []);

	// Listens for the combination while the person is choosing one. Escape gives
	// up, and a bare key is ignored: the main process refuses it anyway, and the
	// page should not look as if it took it.
	useEffect(() => {
		if (!recording) return;
		function onKeyDown(event: KeyboardEvent) {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setRecording(false);
				return;
			}
			const accelerator = acceleratorFromEvent(event);
			if (!accelerator) return;
			setRecording(false);
			void save({ newNoteShortcut: { accelerator } });
		}
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [recording, save]);

	async function setKeepRunning(next: boolean) {
		setBusy(true);
		setError(null);
		try {
			await window.juno.agent.server.setBackground(next);
			setView(await window.juno.desktop.get());
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Section
			title="Notifications and tray"
			anchor="desktop"
			description="Toasts, the tray icon, the taskbar badge and a shortcut for a new note. Nothing here sends anything off this computer."
		>
			{view === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : !view.supported ? (
				<p className="text-dense text-[var(--ink-muted)]">These settings are for Windows.</p>
			) : (
				<div className="flex flex-col gap-5">
					<Toggle
						label="Show notifications"
						description="A summary of what is due once a day, and a note when agent requests are waiting. A reminder can be completed or snoozed from the toast. A request can only be opened from it."
						checked={view.settings.toasts}
						disabled={busy}
						onChange={(next) => void save({ toasts: next })}
					/>
					<Toggle
						label="Show the number of requests on the taskbar"
						description="The count of agent requests waiting for you, on the Juno button. It clears when the last one is answered."
						checked={view.settings.badge}
						disabled={busy}
						onChange={(next) => void save({ badge: next })}
					/>
					<Toggle
						label="Keep an icon in the tray"
						description={
							view.keepRunning
								? "The icon stays while Juno runs without a window, whatever this says."
								: "Open Juno, start a new note or quit from the notification area."
						}
						checked={view.settings.tray || view.keepRunning}
						disabled={busy || view.keepRunning}
						onChange={(next) => void save({ tray: next })}
					/>
					<Toggle
						label="Keep Juno running when I close the window"
						description="Agents can still reach Juno, and it starts with your computer. Closing the window locks it. Quit from the tray icon."
						checked={view.keepRunning}
						disabled={busy}
						onChange={(next) => void setKeepRunning(next)}
					/>

					<div>
						<Toggle
							label="Shortcut for a new note"
							description="Works from any program while Juno is running. Off until you turn it on."
							checked={view.settings.newNoteShortcut.enabled}
							disabled={busy}
							onChange={(next) => void save({ newNoteShortcut: { enabled: next } })}
						/>
						{view.settings.newNoteShortcut.enabled ? (
							<div className="mt-3 flex items-center gap-3">
								{recording ? (
									<span className="text-dense text-[var(--ink-muted)]" role="status">
										Press the keys you want. Escape cancels.
									</span>
								) : (
									<Kbd keys={view.settings.newNoteShortcut.accelerator.split("+")} />
								)}
								<Button size="dense" disabled={busy} onClick={() => setRecording((on) => !on)}>
									{recording ? "Cancel" : "Change"}
								</Button>
							</div>
						) : null}
						{view.settings.newNoteShortcut.enabled && view.shortcut.problem ? (
							<p role="alert" data-selectable className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
								{view.shortcut.problem}
							</p>
						) : null}
					</div>
				</div>
			)}
			<SectionError message={error} />
		</Section>
	);
}
