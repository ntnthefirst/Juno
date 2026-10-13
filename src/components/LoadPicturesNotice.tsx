import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

type LoadPicturesNoticeProps = {
	/** Addresses that are still drawn as a box. */
	pending: string[];
	/** Runs after the person confirmed. Resolves to an error message, or null. */
	onConfirm: () => Promise<string | null>;
};

function hostOf(address: string): string {
	try {
		return new URL(address).host;
	} catch {
		return address;
	}
}

/**
 * Says that a message links pictures Juno does not draw, and asks whether the
 * source can be trusted before anything is downloaded. Nothing is fetched
 * until the dialog is confirmed, and the message itself is not changed.
 */
export function LoadPicturesNotice({ pending, onConfirm }: LoadPicturesNoticeProps) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (pending.length === 0) return null;
	const hosts = [...new Set(pending.map(hostOf))];

	async function confirm() {
		setBusy(true);
		const failed = await onConfirm();
		setBusy(false);
		setError(failed);
		if (!failed) setOpen(false);
	}

	return (
		<div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
			<span className="min-w-0 flex-1">
				{pending.length === 1 ? "1 picture is" : `${pending.length} pictures are`} linked from {hosts.join(", ")} and not shown here.
			</span>
			{error && !open ? (
				<span role="alert" data-selectable className="text-[var(--risk)]">
					{error}
				</span>
			) : null}
			<Button size="dense" onClick={() => setOpen(true)}>
				Load pictures
			</Button>
			{open ? (
				<Dialog title="Load these pictures?" onClose={() => (busy ? undefined : setOpen(false))} width="narrow">
					<p className="text-[var(--ink)]">
						Juno will download {pending.length === 1 ? "the picture" : "the pictures"} from {hosts.join(", ")} to show{" "}
						{pending.length === 1 ? "it" : "them"} here. The server sees your address when it does. Only continue if you trust this
						source.
					</p>
					<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						The message is not changed. The recipient&apos;s mail client still loads the pictures itself.
					</p>
					{error ? (
						<p role="alert" data-selectable className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
							{error}
						</p>
					) : null}
					<div className="mt-4 flex justify-end gap-2">
						<Button disabled={busy} onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button variant="primary" disabled={busy} onClick={() => void confirm()}>
							{busy ? "Loading" : "Load pictures"}
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
