import { useState } from "react";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

type AgentLogSectionProps = {
	onDone: (message: string) => void;
};

/**
 * The log of what an agent did runs itself down: writes are kept six months and
 * reads thirty days. The button runs that same purge now. There is no tool for
 * it, since an agent must not be able to erase its own trail.
 */
export function AgentLogSection({ onDone }: AgentLogSectionProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function purge() {
		setBusy(true);
		setError(null);
		try {
			const removed = await window.juno.agent.audit.purge();
			onDone(removed === 0 ? "Nothing to purge." : `${removed} log ${removed === 1 ? "entry" : "entries"} purged.`);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Section
			title="Agent log"
			anchor="agent-log"
			large
			description="Entries older than six months are purged."
		>
			<Button variant="danger" disabled={busy} onClick={() => void purge()}>
				Purge the log now
			</Button>
			<SectionError message={error} />
		</Section>
	);
}
