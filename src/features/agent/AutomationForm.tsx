import { useEffect, useState, type FormEvent } from "react";
import type { Automation, AutomationStep, AutomationTrigger, ToolSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type AutomationFormProps = {
	/** Null creates, an automation edits. */
	automation: Automation | null;
	onClose: () => void;
	onSaved: () => void;
};

type TriggerKind = "manual" | "daily" | "weekly";

const WEEKDAYS = [
	{ value: "1", label: "Monday" },
	{ value: "2", label: "Tuesday" },
	{ value: "3", label: "Wednesday" },
	{ value: "4", label: "Thursday" },
	{ value: "5", label: "Friday" },
	{ value: "6", label: "Saturday" },
	{ value: "7", label: "Sunday" },
];

/**
 * A step is a tool and its arguments, typed as JSON.
 *
 * Deliberately not a builder with a form per tool: there are ninety-odd tools
 * and their arguments are already described in the tool list beside this
 * screen. A wrong tool name or a malformed object is refused by the service
 * with a message that says which step.
 */
export function AutomationForm({ automation, onClose, onSaved }: AutomationFormProps) {
	const [name, setName] = useState(automation?.name ?? "");
	const [description, setDescription] = useState(automation?.description ?? "");
	const [kind, setKind] = useState<TriggerKind>(automation?.trigger.kind ?? "manual");
	const [time, setTime] = useState(
		automation && automation.trigger.kind !== "manual" ? automation.trigger.time : "08:30",
	);
	const [weekday, setWeekday] = useState(
		automation && automation.trigger.kind === "weekly" ? String(automation.trigger.weekday) : "1",
	);
	const [stepsText, setStepsText] = useState(() =>
		JSON.stringify(automation?.steps ?? [{ tool: "briefing.today", args: {} }], null, "\t"),
	);
	const [tools, setTools] = useState<ToolSummary[]>([]);
	const [nameError, setNameError] = useState<string | null>(null);
	const [stepsError, setStepsError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.agent
			.tools()
			.then((rows) => {
				if (!cancelled) setTools(rows);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	function parseSteps(): AutomationStep[] | null {
		let parsed: unknown;
		try {
			parsed = JSON.parse(stepsText);
		} catch (cause: unknown) {
			setStepsError(`That is not valid JSON. ${messageOf(cause)}`);
			return null;
		}
		if (!Array.isArray(parsed) || parsed.length === 0) {
			setStepsError("The steps are a list, and it needs at least one.");
			return null;
		}
		const steps: AutomationStep[] = [];
		for (const [index, entry] of parsed.entries()) {
			if (!entry || typeof entry !== "object" || typeof (entry as AutomationStep).tool !== "string") {
				setStepsError(`Step ${index + 1} needs a tool name.`);
				return null;
			}
			steps.push({ tool: (entry as AutomationStep).tool, args: (entry as AutomationStep).args ?? {} });
		}
		setStepsError(null);
		return steps;
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;

		const trimmed = name.trim();
		setNameError(trimmed ? null : "Enter a name.");
		const steps = parseSteps();
		if (!trimmed || !steps) return;

		const trigger: AutomationTrigger =
			kind === "daily"
				? { kind: "daily", time }
				: kind === "weekly"
					? { kind: "weekly", weekday: Number(weekday), time }
					: { kind: "manual" };

		setError(null);
		setBusy(true);
		try {
			const input = {
				name: trimmed,
				description: description.trim() || null,
				trigger,
				steps,
			};
			if (automation) await window.juno.automations.update(automation.id, input);
			else await window.juno.automations.create(input);
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	const gated = tools.filter((tool) => !tool.readOnly && (tool.requiresConfirmation || tool.gatedInService));
	const stepTools = (() => {
		try {
			const parsed: unknown = JSON.parse(stepsText);
			return Array.isArray(parsed) ? parsed.map((step) => String((step as AutomationStep)?.tool ?? "")) : [];
		} catch {
			return [];
		}
	})();
	const willWait = stepTools.some((tool) => gated.some((entry) => entry.name === tool));

	return (
		<Dialog title={automation ? "Edit automation" : "New automation"} onClose={onClose} width="wide">
			<form onSubmit={submit} noValidate className="mt-5">
				<div className="grid grid-cols-2 gap-4">
					<div className="col-span-2">
						<Field label="Name" required value={name} onChange={setName} error={nameError} />
					</div>
					<div className="col-span-2">
						<Field label="Description" value={description} onChange={setDescription} />
					</div>

					<Select
						label="Runs"
						value={kind}
						onChange={(value) => setKind(value as TriggerKind)}
						options={[
							{ value: "manual", label: "Only when you run it" },
							{ value: "daily", label: "Every day" },
							{ value: "weekly", label: "Every week" },
						]}
					/>
					{kind === "manual" ? (
						<div />
					) : (
						<Field label="At" type="time" value={time} onChange={setTime} tabular />
					)}
					{kind === "weekly" ? (
						<div className="col-span-2">
							<Select label="On" value={weekday} onChange={setWeekday} options={WEEKDAYS} />
						</div>
					) : null}

					<div className="col-span-2">
						<Field
							label="Steps"
							multiline
							rows={10}
							value={stepsText}
							onChange={setStepsText}
							error={stepsError}
						/>
						<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							A list of steps, each with a tool and its arguments. The tool names and what they
							take are listed under Connection.
						</p>
						{willWait ? (
							<p className="mt-2 text-[length:var(--text-sm)] text-[var(--warn)]">
								One of these steps needs your approval. The run will stop there and wait for you,
								every time, including on a schedule.
							</p>
						) : null}
					</div>
				</div>

				{error ? (
					<div className="mt-4 border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this automation.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}

				<div className="mt-6 flex justify-end gap-2">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
