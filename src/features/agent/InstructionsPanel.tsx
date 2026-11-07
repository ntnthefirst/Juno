import { useEffect, useRef, useState } from "react";
import type { AgentInstructions, AgentInstructionsView } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { MenuButton } from "../../components/Menu";
import { Notice } from "../../components/Notice";
import { messageOf } from "../../lib/errors";
import { Section } from "../settings/Section";

type InstructionsPanelProps = {
	onNotice: (message: string) => void;
};

/** How long typing has to stop before it is saved. */
const SAVE_AFTER_MS = 600;

/**
 * What every connected agent is told when it connects: one text for everyone,
 * one for mail, and one per area the owner adds. Saved as it is typed, so there
 * is no button to forget.
 */
export function InstructionsPanel({ onNotice }: InstructionsPanelProps) {
	const [view, setView] = useState<AgentInstructionsView | null>(null);
	const [draft, setDraft] = useState<AgentInstructions | null>(null);
	const [error, setError] = useState<string | null>(null);
	const timer = useRef<number | null>(null);
	const latest = useRef<AgentInstructions | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.agent.instructions
			.get()
			.then((loaded) => {
				if (cancelled) return;
				setView(loaded);
				setDraft(loaded.instructions);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// A page closed in the middle of a pause still saves what was typed.
	useEffect(
		() => () => {
			if (timer.current !== null && latest.current) {
				window.clearTimeout(timer.current);
				void window.juno.agent.instructions.set(latest.current).catch(() => undefined);
			}
		},
		[],
	);

	function change(next: AgentInstructions, at: number = SAVE_AFTER_MS) {
		setDraft(next);
		latest.current = next;
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			window.juno.agent.instructions.set(next).catch((cause: unknown) => onNotice(messageOf(cause)));
		}, at);
	}

	if (error) return <Notice tone="risk" layout="inline">{error}</Notice>;
	if (!view || !draft) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	const free = view.areas.filter((area) => !draft.areas.some((used) => used.area === area.id));

	return (
		<Section
			title="Instructions"
			anchor="mcp-instructions"
			description="Tell every agent how you like to work. They read this before they start, and you can change it at any time."
		>
			<div className="flex flex-col gap-6">
				<Field
					label="For everyone"
					multiline
					rows={5}
					value={draft.everyone}
					help="Saved as you type."
					onChange={(value) => change({ ...draft, everyone: value.slice(0, view.maxLength) })}
				/>
				<Field
					label="For mail only"
					multiline
					rows={5}
					value={draft.mail}
					help="Saved as you type."
					onChange={(value) => change({ ...draft, mail: value.slice(0, view.maxLength) })}
				/>
				{draft.areas.map((entry) => {
					const label = view.areas.find((area) => area.id === entry.area)?.label ?? entry.area;
					return (
						<div key={entry.area}>
							<Field
								label={`For ${label.toLowerCase()} only`}
								multiline
								rows={4}
								value={entry.text}
								help="Saved as you type."
								onChange={(value) =>
									change({
										...draft,
										areas: draft.areas.map((other) =>
											other.area === entry.area ? { ...other, text: value.slice(0, view.maxLength) } : other,
										),
									})
								}
							/>
							<Button
								size="dense"
								variant="quiet"
								onClick={() => change({ ...draft, areas: draft.areas.filter((other) => other.area !== entry.area) }, 0)}
							>
								Remove these instructions
							</Button>
						</div>
					);
				})}

				{free.length > 0 ? (
					<div>
						<MenuButton
							ariaLabel="Add instructions for another area"
							label="Add instructions for another area"
							icon="add"
							size="base"
							items={free.map((area) => ({
								id: area.id,
								label: area.label,
								onSelect: () => change({ ...draft, areas: [...draft.areas, { area: area.id, text: "" }] }, 0),
							}))}
						/>
					</div>
				) : null}
			</div>
		</Section>
	);
}
