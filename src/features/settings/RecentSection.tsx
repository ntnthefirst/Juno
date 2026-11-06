import { useState } from "react";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

type RecentSectionProps = {
	onDone: (message: string) => void;
};

/** The list behind the Recent menu in the title bar, and the one button that empties it. */
export function RecentSection({ onDone }: RecentSectionProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function clear() {
		setBusy(true);
		setError(null);
		try {
			await window.juno.recent.clear();
			onDone("Recent list cleared.");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Section
			title="Recent"
			anchor="recent"
			description="Juno remembers the last 20 records you opened, so the Recent menu can take you back to them. Clearing the list does not delete any record."
			action={
				<Button size="dense" disabled={busy} onClick={() => void clear()}>
					Clear recent
				</Button>
			}
		>
			<SectionError message={error} />
		</Section>
	);
}
