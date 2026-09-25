import { type FormEvent, useId, useState } from "react";
import type { ProjectCommand, ProjectCommandKind } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { SidePanel } from "../../components/SidePanel";
import { messageOf } from "../../lib/errors";

type CommandPanelProps = {
	projectId: string;
	/** Null adds, a command edits. */
	command: ProjectCommand | null;
	/** Shown as the fallback working directory when the field is empty. */
	fallbackDir: string | null;
	onClose: () => void;
	onSaved: () => void;
};

/**
 * Writing a command, with the one thing a person has to know about it said
 * plainly on the panel rather than in a help page: it runs in a real shell,
 * with their account, exactly as if they had typed it in a terminal.
 *
 * That sentence is not decoration. It is the same class of copy as the lock
 * screen saying it does not protect the file on disk
 * (.claude/rules/security.md section 8): the interface has to say what the
 * feature actually does, not a softer version of it.
 */
export function CommandPanel({
	projectId,
	command,
	fallbackDir,
	onClose,
	onSaved,
}: CommandPanelProps) {
	const formId = useId();
	const [label, setLabel] = useState(command?.label ?? "");
	const [line, setLine] = useState(command?.command ?? "");
	const [workingDir, setWorkingDir] = useState(command?.workingDir ?? "");
	const [kind, setKind] = useState<ProjectCommandKind>(command?.kind ?? "shell");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);

		try {
			if (command) {
				await window.juno.projects.commands.update(command.id, {
					label,
					command: line,
					workingDir: workingDir.trim() || null,
					kind,
				});
			} else {
				await window.juno.projects.commands.create({
					projectId,
					label,
					command: line,
					workingDir: workingDir.trim() || null,
					kind,
				});
			}
			onSaved();
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(false);
		}
	}

	return (
		<SidePanel
			title={command ? "Edit command" : "Add a command"}
			subtitle="What starts this project"
			onClose={onClose}
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" form={formId} variant="primary" disabled={busy}>
						{busy ? "Saving" : "Save"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
				<Field label="Name" required value={label} onChange={setLabel} placeholder="Dev server" />
				<Field
					label="Command"
					required
					value={line}
					onChange={setLine}
					placeholder="npm run dev"
					help="One line. Put a sequence in a script and call the script."
				/>
				<Select
					label="Kind"
					value={kind}
					onChange={(value) => setKind(value as ProjectCommandKind)}
					options={[
						{ value: "shell", label: "Shell" },
						{ value: "docker", label: "Docker" },
					]}
					help="Picks the icon. Both run the same way."
				/>
				<Field
					label="Run in"
					value={workingDir}
					onChange={setWorkingDir}
					placeholder={fallbackDir ?? "The project's folder"}
					help={
						fallbackDir
							? `Empty runs it in ${fallbackDir}.`
							: "Empty runs it in the project's folder."
					}
				/>

				<div className="flex gap-2 rounded-[var(--radius-md)] bg-[var(--warn-soft)] p-3 text-[length:var(--text-sm)] text-[var(--ink)]">
					<span className="flex-none pt-0.5 text-[var(--warn)]">
						<Icon name="warning" />
					</span>
					<p>
						This runs in a real shell with your account, exactly as if you had typed it in a
						terminal. Nothing else in Juno can write or start a command, and no agent can.
					</p>
				</div>

				{error ? (
					<div className="border-l-2 border-[var(--risk)] pl-3">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">
							Could not save this command.
						</p>
						<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{error}
						</p>
					</div>
				) : null}
			</form>
		</SidePanel>
	);
}
