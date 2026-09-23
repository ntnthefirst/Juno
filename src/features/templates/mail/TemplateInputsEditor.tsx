import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { TemplateInput, TemplateInputKind } from "@shared/types";
import { Button } from "../../../components/Button";
import { Field } from "../../../components/Field";
import { Select } from "../../../components/Select";

/** Mirrors KEY_PATTERN in electron/main/services/template-inputs.ts exactly. */
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const KIND_OPTIONS: { value: TemplateInputKind; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "textarea", label: "Long text" },
	{ value: "number", label: "Number" },
	{ value: "money", label: "Amount" },
	{ value: "date", label: "Date" },
	{ value: "choice", label: "Choice" },
];

const ICON_BUTTON =
	"flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40";

type TemplateInputsEditorProps = {
	inputs: TemplateInput[];
	onChange: (inputs: TemplateInput[]) => void;
	disabled?: boolean;
};

/**
 * What a template asks for when it is used, declared here and filled in
 * later by TemplateInputFields. The key rule and the "a choice needs an
 * option" rule mirror template-inputs.ts's validateInputs exactly, so a bad
 * key is caught while typing rather than only after the save round-trips to
 * the service, which still has the final say and whose message is shown as-is
 * if it disagrees.
 */
export function TemplateInputsEditor({ inputs, onChange, disabled = false }: TemplateInputsEditorProps) {
	const keyCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const input of inputs) {
			if (!input.key) continue;
			counts.set(input.key, (counts.get(input.key) ?? 0) + 1);
		}
		return counts;
	}, [inputs]);

	function update(index: number, patch: Partial<TemplateInput>) {
		onChange(inputs.map((input, i) => (i === index ? { ...input, ...patch } : input)));
	}

	function remove(index: number) {
		onChange(inputs.filter((_, i) => i !== index));
	}

	function move(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= inputs.length) return;
		const next = [...inputs];
		const [entry] = next.splice(index, 1);
		next.splice(target, 0, entry!);
		onChange(next);
	}

	function add() {
		onChange([...inputs, { key: "", label: "", kind: "text", required: false }]);
	}

	if (inputs.length === 0) {
		return (
			<div>
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Nothing declared yet. Add one for a value nothing in the records can answer: the scope
					of the work, an amount agreed on the phone, a deadline.
				</p>
				<Button disabled={disabled} onClick={add} size="dense">
					<PlusIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
					Add an input
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{inputs.map((input, index) => {
				const keyError = !input.key
					? null
					: !KEY_PATTERN.test(input.key)
						? "Lowercase letters, digits and underscores only, starting with a letter."
						: (keyCounts.get(input.key) ?? 0) > 1
							? "Another input already uses this key."
							: null;

				return (
					<div key={index} className="rounded-[var(--radius-lg)] border border-[var(--line)] p-4">
						<div className="flex items-start gap-3">
							<div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<Field
										label="Key"
										value={input.key}
										onChange={(value) => update(index, { key: value.trim().toLowerCase() })}
										error={keyError}
										help="Lowercase letters, digits and underscores, starting with a letter."
										disabled={disabled}
										required
									/>
									{input.key && !keyError ? (
										<p className="mt-1 font-mono text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{`{{document.${input.key}}}`}
										</p>
									) : null}
								</div>
								<Field
									label="Label"
									value={input.label}
									onChange={(value) => update(index, { label: value })}
									disabled={disabled}
									required
								/>
								<Select
									label="Kind"
									value={input.kind}
									onChange={(value) => update(index, { kind: value as TemplateInputKind })}
									options={KIND_OPTIONS}
									disabled={disabled}
								/>
								<div className="flex items-end pb-2">
									<label className="flex items-center gap-2 text-[length:var(--text-base)] text-[var(--ink)]">
										<input
											type="checkbox"
											checked={input.required}
											disabled={disabled}
											onChange={(event) => update(index, { required: event.target.checked })}
											className="accent-[var(--accent)]"
										/>
										Required
									</label>
								</div>
								<div className="sm:col-span-2">
									<Field
										label="Help text"
										value={input.help ?? ""}
										onChange={(value) => update(index, { help: value || null })}
										disabled={disabled}
										help="One sentence, shown under the field when the template is used."
									/>
								</div>
								{input.kind === "choice" ? (
									<div className="sm:col-span-2">
										<OptionsEditor
											options={input.options ?? []}
											onChange={(options) => update(index, { options })}
											disabled={disabled}
										/>
									</div>
								) : null}
							</div>

							<div className="flex flex-none flex-col items-center gap-1">
								<button
									type="button"
									aria-label="Move up"
									title="Move up"
									disabled={disabled || index === 0}
									onClick={() => move(index, -1)}
									className={ICON_BUTTON}
								>
									<ChevronUpIcon width={16} height={16} aria-hidden />
								</button>
								<button
									type="button"
									aria-label="Move down"
									title="Move down"
									disabled={disabled || index === inputs.length - 1}
									onClick={() => move(index, 1)}
									className={ICON_BUTTON}
								>
									<ChevronDownIcon width={16} height={16} aria-hidden />
								</button>
								<button
									type="button"
									aria-label="Remove this input"
									title="Remove"
									disabled={disabled}
									onClick={() => remove(index)}
									className={`${ICON_BUTTON} hover:text-[var(--risk)]`}
								>
									<TrashIcon width={16} height={16} aria-hidden />
								</button>
							</div>
						</div>
					</div>
				);
			})}

			<Button disabled={disabled} onClick={add}>
				<PlusIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
				Add an input
			</Button>
		</div>
	);
}

type OptionsEditorProps = {
	options: string[];
	onChange: (options: string[]) => void;
	disabled: boolean;
};

/**
 * Chips rather than a comma-separated field: a text field whose value is
 * derived from `options.join(", ")` would fight the cursor the moment a
 * comma is typed, for the same reason a controlled value normally does.
 * Keeping the draft text local and out of that round trip avoids it.
 */
function OptionsEditor({ options, onChange, disabled }: OptionsEditorProps) {
	const [draft, setDraft] = useState("");

	function add() {
		const value = draft.trim();
		if (!value || options.includes(value)) {
			setDraft("");
			return;
		}
		onChange([...options, value]);
		setDraft("");
	}

	return (
		<div>
			<span className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">Options</span>
			{options.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{options.map((option) => (
						<span
							key={option}
							className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-1 text-[length:var(--text-dense)]"
						>
							{option}
							<button
								type="button"
								aria-label={`Remove ${option}`}
								disabled={disabled}
								onClick={() => onChange(options.filter((o) => o !== option))}
								className="text-[var(--ink-faint)] hover:text-[var(--risk)]"
							>
								<XMarkIcon width={12} height={12} aria-hidden />
							</button>
						</span>
					))}
				</div>
			) : (
				<p className="text-[length:var(--text-sm)] text-[var(--risk)]">Needs at least one option.</p>
			)}
			<div className="mt-2 flex gap-2">
				<input
					type="text"
					value={draft}
					disabled={disabled}
					placeholder="Add an option"
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						add();
					}}
					className="w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-1.5 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)] disabled:opacity-60"
				/>
				<Button size="dense" disabled={disabled || !draft.trim()} onClick={add}>
					Add
				</Button>
			</div>
		</div>
	);
}
