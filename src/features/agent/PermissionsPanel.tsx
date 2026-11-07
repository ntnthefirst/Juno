import { useEffect, useState } from "react";
import type { AgentLevel, AgentPermissionKind, AgentPermissionsView, SuggestionSources } from "@shared/types";
import { Notice } from "../../components/Notice";
import { Segmented } from "../../components/Segmented";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { Section } from "../settings/Section";

const LEVEL_LABELS: Record<AgentLevel, string> = { off: "Off", ask: "Ask first", allow: "Allow" };
const LEVELS: AgentLevel[] = ["off", "ask", "allow"];

type PermissionsPanelProps = {
	onNotice: (message: string) => void;
};

/**
 * What an agent may do, one row per kind of thing, and which suggestions Juno
 * makes. The levels are enforced in the service (decision 57), so this page
 * only draws them and says no when a locked row is asked for Allow.
 */
export function PermissionsPanel({ onNotice }: PermissionsPanelProps) {
	const [view, setView] = useState<AgentPermissionsView | null>(null);
	const [sources, setSources] = useState<SuggestionSources | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.agent.permissions.get(), window.juno.suggestions.sources.get()])
			.then(([permissions, suggestionSources]) => {
				if (cancelled) return;
				setView(permissions);
				setSources(suggestionSources);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function choose(kind: AgentPermissionKind, level: AgentLevel) {
		try {
			setView(await window.juno.agent.permissions.set({ [kind]: level }));
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	async function switchSource(patch: Partial<SuggestionSources>) {
		try {
			setSources(await window.juno.suggestions.sources.set(patch));
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	if (error) return <Notice tone="risk" layout="inline">{error}</Notice>;
	if (!view || !sources) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	return (
		<>
			<Section
				title="What it may do"
				anchor="mcp-permissions"
				description="Choose what an agent may do in Juno. Anything that sends, signs, files or deletes always asks you first, whatever you pick."
			>
				<ul>
					{view.rows.map((row) => (
						<li
							key={row.kind}
							className="flex min-h-[64px] items-center justify-between gap-6 border-b border-[var(--line)] py-3 last:border-b-0"
						>
							<div className="min-w-0">
								<p className="text-base text-[var(--ink)]">{row.label}</p>
								<p className="text-sm text-[var(--ink-muted)]">{row.description}</p>
							</div>
							<Segmented
								label={row.label}
								size="compact"
								value={view.levels[row.kind]}
								onChange={(level) => void choose(row.kind, level)}
								options={LEVELS.map((level) => ({
									id: level,
									label: LEVEL_LABELS[level],
									locked: row.locked && level === "allow",
									name: row.locked && level === "allow" ? "Always asks first" : LEVEL_LABELS[level],
								}))}
							/>
						</li>
					))}
				</ul>
			</Section>

			<Section title="Suggestions" anchor="mcp-suggestions">
				{/* The design has one switch. It sets both sources, so a person who had one off sees it off here and turning it on brings both back. */}
				<Toggle
					label="From mail"
					description="Dates, deadlines and which project a message belongs to."
					checked={sources.calendar && sources.projects}
					onChange={(next) => void switchSource({ calendar: next, projects: next })}
				/>
			</Section>
		</>
	);
}
