import { useId, useMemo, useState, type FormEvent } from "react";
import type { MailAccount, MailFolder, MailRule } from "@shared/types";
import { MAX_RULE_CONDITIONS, describeRule } from "@shared/mail-rules";
import { Button } from "../../../components/Button";
import { Checkbox } from "../../../components/Checkbox";
import { Field } from "../../../components/Field";
import { FormPage } from "../../../components/FormPage";
import { IconButton } from "../../../components/IconButton";
import { Notice } from "../../../components/Notice";
import { Segmented } from "../../../components/Segmented";
import { Toggle } from "../../../components/Toggle";
import { messageOf } from "../../../lib/errors";
import {
	TEST_OPTIONS,
	WHAT_OPTIONS,
	actionsOf,
	blankCondition,
	blankDraft,
	conditionsOf,
	draftOf,
	type ConditionDraft,
	type RuleDraft,
	type WhatDraft,
	type WhereDraft,
} from "./rule-draft";

type MailRuleFormProps = {
	account: MailAccount;
	/** The account's folders, from the last sync. */
	folders: MailFolder[];
	/** Null starts a new rule. */
	rule: MailRule | null;
	onClose: () => void;
	onSaved: (rule: MailRule) => void;
};

const SELECT =
	"h-9 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 text-base text-[var(--ink)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]";

const OVERLINE = "mb-2 block text-overline text-[var(--ink-muted)] uppercase";

const WHERE_OPTIONS: { id: WhereDraft; label: string }[] = [
	{ id: "stay", label: "Leave it" },
	{ id: "folder", label: "Move to a folder" },
	{ id: "trash", label: "Trash" },
	{ id: "archive", label: "Archive" },
];

/**
 * One rule, as a page. The tests on a new message come first, then what to do
 * with the ones that pass, then whether the rules below still see it. At the
 * bottom the rule is read back in plain words, the same words an agent's request
 * for a rule would show, so what is saved is never a surprise.
 */
export function MailRuleForm({ account, folders, rule, onClose, onSaved }: MailRuleFormProps) {
	const [draft, setDraft] = useState<RuleDraft>(() => (rule ? draftOf(rule) : blankDraft()));
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const formId = useId();

	// The inbox is where mail arrives, so moving to it would do nothing.
	const targets = useMemo(() => folders.filter((folder) => folder.specialUse !== "inbox"), [folders]);

	const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
	const setCondition = (key: string, patch: Partial<ConditionDraft>) =>
		setDraft((current) => ({
			...current,
			conditions: current.conditions.map((condition) => (condition.key === key ? { ...condition, ...patch } : condition)),
		}));

	const moves = draft.where !== "stay";
	const plain = useMemo(() => {
		const conditions = conditionsOf(draft).filter((condition) => condition.kind !== "text" || condition.value.trim() !== "");
		const actions = actionsOf(draft);
		if (conditions.length === 0 || actions.length === 0) return null;
		return describeRule(
			{
				name: draft.name.trim() || "Untitled",
				enabled: draft.enabled,
				match: draft.match,
				conditions,
				actions,
				stopOnMatch: draft.stopOnMatch,
			},
			{ accountEmail: account.email, folderName: (id) => folders.find((folder) => folder.id === id)?.name ?? null },
		);
	}, [draft, account.email, folders]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		setSaving(true);
		try {
			const body = {
				name: draft.name,
				enabled: draft.enabled,
				match: draft.match,
				conditions: conditionsOf(draft),
				actions: actionsOf(draft),
				stopOnMatch: moves ? false : draft.stopOnMatch,
			};
			const saved = rule
				? await window.juno.mail.rules.update(rule.id, body)
				: await window.juno.mail.rules.create({ accountId: account.id, ...body });
			onSaved(saved);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setSaving(false);
		}
	}

	return (
		<FormPage
			title={rule ? rule.name : "New rule"}
			backLabel={account.label}
			onBack={onClose}
			width="wide"
			description="Looks at new mail in the inbox after each sync. It never touches mail that is already there."
			actions={
				<>
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" form={formId} variant="primary" disabled={saving}>
						{saving ? "Saving" : "Save rule"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={(event) => void submit(event)} className="flex max-w-[620px] flex-col gap-6">
				<Field label="Name" value={draft.name} onChange={(value) => set("name", value)} placeholder="Newsletters" required />

				<section aria-label="Conditions">
					<span className={OVERLINE}>When a new message arrives and</span>
					<div className="mb-3">
						<Segmented
							label="How many conditions have to hold"
							value={draft.match}
							onChange={(id) => set("match", id)}
							options={[
								{ id: "all", label: "All of these are true" },
								{ id: "any", label: "Any of these is true" },
							]}
						/>
					</div>
					<ul className="flex flex-col gap-2">
						{draft.conditions.map((condition, index) => (
							<li key={condition.key} className="grid grid-cols-[170px_150px_minmax(0,1fr)_32px] items-center gap-2">
								<select
									aria-label={`Condition ${index + 1}: what to look at`}
									value={condition.what}
									onChange={(event) => setCondition(condition.key, { what: event.target.value as WhatDraft })}
									className={SELECT}
								>
									{WHAT_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
								{condition.what === "client" || condition.what === "attachments" ? (
									<select
										aria-label={`Condition ${index + 1}: yes or no`}
										value={condition.yes ? "yes" : "no"}
										onChange={(event) => setCondition(condition.key, { yes: event.target.value === "yes" })}
										className={`${SELECT} col-span-2`}
									>
										<option value="yes">{condition.what === "client" ? "is a client" : "yes"}</option>
										<option value="no">{condition.what === "client" ? "is not a client" : "no"}</option>
									</select>
								) : (
									<>
										<select
											aria-label={`Condition ${index + 1}: how to compare`}
											value={condition.test}
											onChange={(event) =>
												setCondition(condition.key, { test: event.target.value as ConditionDraft["test"] })
											}
											className={SELECT}
										>
											{TEST_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
										<input
											aria-label={`Condition ${index + 1}: the text`}
											value={condition.value}
											onChange={(event) => setCondition(condition.key, { value: event.target.value })}
											placeholder={condition.what === "subject" ? "invoice" : "news@example.com"}
											className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--focus)] focus:shadow-[inset_0_0_0_1px_var(--focus)]"
										/>
									</>
								)}
								<IconButton
									icon="remove"
									label="Remove condition"
									disabled={draft.conditions.length === 1}
									onClick={() =>
										set(
											"conditions",
											draft.conditions.filter((entry) => entry.key !== condition.key),
										)
									}
								/>
							</li>
						))}
					</ul>
					<div className="mt-2 flex items-center gap-3">
						<Button
							size="dense"
							disabled={draft.conditions.length >= MAX_RULE_CONDITIONS}
							onClick={() => set("conditions", [...draft.conditions, blankCondition()])}
						>
							Add condition
						</Button>
						<p className="text-sm text-[var(--ink-muted)]">Addresses are compared, never the name beside them. Text is plain text, not a pattern.</p>
					</div>
				</section>

				<section aria-label="Actions">
					<span className={OVERLINE}>Then</span>
					<div className="flex flex-col gap-1">
						<ActionCheck label="Mark it read" checked={draft.markRead} onChange={(value) => set("markRead", value)} />
						<ActionCheck label="Flag it" checked={draft.flag} onChange={(value) => set("flag", value)} />
						<ActionCheck
							label="Link its conversation to the client who sent it"
							checked={draft.link}
							onChange={(value) => set("link", value)}
						/>
					</div>
					<div className="mt-3">
						<span className="mb-1.5 block text-sm font-[var(--weight-medium)]">Then put it</span>
						<div className="flex flex-wrap items-center gap-3">
							<Segmented
								label="Where the message goes"
								value={draft.where}
								onChange={(id) => set("where", id)}
								options={WHERE_OPTIONS}
							/>
							{draft.where === "folder" ? (
								<select
									aria-label="Folder to move to"
									value={draft.folderId}
									onChange={(event) => set("folderId", event.target.value)}
									className={`${SELECT} w-[220px]`}
								>
									<option value="">Choose a folder</option>
									{targets.map((folder) => (
										<option key={folder.id} value={folder.id}>
											{folder.path}
										</option>
									))}
								</select>
							) : null}
						</div>
						{draft.where === "folder" && targets.length === 0 ? (
							<p className="mt-2 text-sm text-[var(--ink-muted)]">This account has no other folders yet. Sync it first.</p>
						) : null}
					</div>
				</section>

				<section aria-label="After a match">
					<Toggle
						label="Stop checking the rules below"
						description={
							moves
								? "Not needed here. A message that has been moved is not in the inbox for the rules below."
								: "A message this rule matches is not offered to the rules below it."
						}
						checked={moves ? false : draft.stopOnMatch}
						disabled={moves}
						onChange={(value) => set("stopOnMatch", value)}
					/>
					<div className="mt-3">
						<Toggle
							label="Switched on"
							description="A switched off rule is kept and does nothing."
							checked={draft.enabled}
							onChange={(value) => set("enabled", value)}
						/>
					</div>
				</section>

				{plain ? (
					<Notice tone="info" layout="inline">
						<span data-selectable>{plain}</span>
					</Notice>
				) : null}
				{error ? (
					<Notice tone="risk" layout="inline" role="alert">
						<span data-selectable>{error}</span>
					</Notice>
				) : null}
			</form>
		</FormPage>
	);
}

type ActionCheckProps = {
	label: string;
	checked: boolean;
	onChange: (value: boolean) => void;
};

function ActionCheck({ label, checked, onChange }: ActionCheckProps) {
	return (
		<label className="flex min-h-[32px] cursor-pointer items-center gap-3 text-base">
			<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />
			{label}
		</label>
	);
}
