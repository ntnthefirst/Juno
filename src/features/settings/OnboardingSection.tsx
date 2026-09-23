import { useState } from "react";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

type OnboardingSectionProps = {
	onNotice: (message: string) => void;
};

/**
 * Replays for the first-run flow. Neither can start here: the walkthrough
 * runs over the main window and setup has a window of its own, and this one
 * sits in front of both as a modal. So both write the state the main window
 * checks, and it checks as soon as this window closes. See App.tsx.
 */
export function OnboardingSection({ onNotice }: OnboardingSectionProps) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"walkthrough" | "setup" | null>(null);

	async function replayWalkthrough() {
		setBusy("walkthrough");
		setError(null);
		try {
			await window.juno.settings.setOnboarding({ walkthroughSeenAt: null });
			onNotice("The walkthrough starts once this window is closed.");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	async function replaySetup() {
		setBusy("setup");
		setError(null);
		try {
			await window.juno.settings.setOnboarding({ completedAt: null });
			onNotice("Setup opens once this window is closed.");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	return (
		<Section
			title="Getting started"
			description="Both of these start as soon as this window is closed."
		>
			<div className="flex flex-col gap-5">
				<Row
					description="A guided tour of the sidebar and what each screen behind it is for."
					button="Show the walkthrough again"
					disabled={busy !== null}
					onClick={() => void replayWalkthrough()}
				/>
				<Row
					description="Asks the setup questions again, in its own small window. It deletes nothing and only asks what a first run asks."
					button="Run setup again"
					disabled={busy !== null}
					onClick={() => void replaySetup()}
				/>
			</div>
			<SectionError message={error} />
		</Section>
	);
}

type RowProps = {
	description: string;
	button: string;
	disabled: boolean;
	onClick: () => void;
};

function Row({ description, button, disabled, onClick }: RowProps) {
	return (
		<div className="flex items-center justify-between gap-4">
			<p className="max-w-[46ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">{description}</p>
			<Button disabled={disabled} onClick={onClick}>
				{button}
			</Button>
		</div>
	);
}
