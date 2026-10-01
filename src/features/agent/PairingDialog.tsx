import { useCallback, useEffect, useState } from "react";
import type { PairingRequest } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type PairingDialogProps = {
	/** Called with the name the client gave itself, once the right code was typed. */
	onConnected: (clientName: string) => void;
};

const CODE_LENGTH = 6;

/**
 * The prompt a client's first connection raises.
 *
 * It does not show a code. The code is on the page the client opened in the
 * browser, and the person types it here. That is the whole defence: a program
 * that started this without the person knowing has nothing to type, and a
 * prompt with a button to press would be answered by habit.
 *
 * Which window shows it matters. The settings window is modal, so while it is
 * open the main window cannot take a click, and a prompt drawn only there would
 * sit unanswered behind it. Both windows mount this, and either one answering
 * clears it in the other.
 */
export function PairingDialog({ onConnected }: PairingDialogProps) {
	const [requests, setRequests] = useState<PairingRequest[]>([]);

	const reload = useCallback(() => {
		window.juno.agent.pairing
			.list()
			.then(setRequests)
			.catch(() => {
				// Nothing to show is the safe reading of a list that would not load.
			});
	}, []);

	useEffect(() => {
		reload();
		return window.juno.agent.connections.onChange(reload);
	}, [reload]);

	const current = requests[0];
	if (!current) return null;

	// Keyed, so the next request starts with an empty box and none of the last one's message.
	return <PairingPrompt key={current.id} request={current} onConnected={onConnected} onChanged={reload} />;
}

type PairingPromptProps = {
	request: PairingRequest;
	onConnected: (clientName: string) => void;
	onChanged: () => void;
};

function PairingPrompt({ request, onConnected, onChanged }: PairingPromptProps) {
	const [typed, setTyped] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(digits: string) {
		if (busy) return;
		setBusy(true);
		try {
			const answer = await window.juno.agent.pairing.answer(request.id, digits);
			if (answer.accepted) {
				onConnected(answer.clientName);
			} else if (answer.reason === "wrong-code") {
				setTyped("");
				setMessage(
					`That is not the code. ${answer.attemptsLeft} ${answer.attemptsLeft === 1 ? "try" : "tries"} left.`,
				);
			} else if (answer.reason === "too-many-attempts") {
				setMessage("Too many wrong codes. Start the connection again from the app.");
			} else {
				setMessage("That request has closed. Start the connection again from the app.");
			}
			onChanged();
		} catch (cause: unknown) {
			setMessage(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	function change(value: string) {
		const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
		setTyped(digits);
		setMessage(null);
		// The sixth digit is the answer. Nothing else on this prompt needs a second press.
		if (digits.length === CODE_LENGTH) void submit(digits);
	}

	async function deny() {
		try {
			await window.juno.agent.pairing.deny(request.id);
		} finally {
			onChanged();
		}
	}

	const display = typed.length > 3 ? `${typed.slice(0, 3)} ${typed.slice(3)}` : typed;

	return (
		<Dialog
			title="Connect an app"
			width="narrow"
			// Only Deny closes it. Escape or a click outside would be an answer nobody gave.
			onClose={() => undefined}
		>
			<p className="mt-3 text-[var(--ink)]">
				<span className="font-[var(--weight-semibold)]">{request.clientName}</span> wants to use Juno on this
				computer.
			</p>
			<p className="mt-2 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
				Type the code on the page it just opened in your browser.
			</p>

			<label className="mt-5 block">
				<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Code</span>
				<input
					value={display}
					onChange={(event) => change(event.target.value)}
					inputMode="numeric"
					autoComplete="off"
					autoFocus
					spellCheck={false}
					readOnly={busy}
					placeholder="000 000"
					aria-describedby="pairing-message"
					className="tabular w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-center font-mono text-[length:var(--text-h3)] tracking-[0.2em] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
				/>
			</label>

			<p
				id="pairing-message"
				role={message ? "alert" : undefined}
				className="mt-2 min-h-[1.5em] text-[length:var(--text-sm)] text-[var(--risk)]"
			>
				{message}
			</p>

			<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				It would go back to <span className="font-mono">{request.redirectHost}</span>. If you did not just connect
				an app yourself, press Deny.
			</p>

			<div className="mt-5 flex justify-end">
				<Button variant="danger" onClick={() => void deny()} disabled={busy}>
					Deny
				</Button>
			</div>
		</Dialog>
	);
}
