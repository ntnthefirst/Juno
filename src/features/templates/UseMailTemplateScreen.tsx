import { useEffect, useState } from "react";
import type {
	ClientSummary,
	MailAccount,
	MailAddress,
	MailOutboxMessage,
	MailTemplate,
	MailTemplateRender,
	ProjectSummary,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { FormPage, type FormStep } from "../../components/FormPage";
import { Select } from "../../components/Select";
import { TemplateInputFields } from "../../components/TemplateInputFields";
import { messageOf } from "../../lib/errors";

type UseMailTemplateScreenProps = {
	template: MailTemplate;
	onBack: () => void;
	/** The draft was created. This screen never sends anything. */
	onCreated: () => void;
};

// Keyed to the inputs the review render was requested with, so a change does
// not need an effect to clear the stale render: it just stops matching.
type ReviewRequestKey = {
	templateId: string;
	clientId: string;
	projectId: string;
	values: Record<string, string>;
};

type ReviewRenderState =
	| (ReviewRequestKey & { status: "ready"; result: MailTemplateRender })
	| (ReviewRequestKey & { status: "error"; message: string });

function sameReviewKey(a: ReviewRequestKey, b: ReviewRequestKey): boolean {
	// values compares by reference: setValues always writes a fresh object, so
	// this is exact and avoids serialising the record on every render.
	return (
		a.templateId === b.templateId && a.clientId === b.clientId && a.projectId === b.projectId && a.values === b.values
	);
}

/**
 * A short address-line parser, the same shape as the one in
 * features/mail/ComposeDialog.tsx. That file belongs to a different owner
 * for this change, so this is written fresh rather than reached into, but
 * the rule ("name <address>" or a bare address, comma-separated) is the same
 * one a person already sees in the mail composer.
 */
function parseAddressLine(line: string): MailAddress[] {
	return line
		.split(/[,;]/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const match = /^(.*?)<([^<>]+)>$/.exec(part);
			if (match) {
				return { name: match[1]!.trim().replace(/^"|"$/g, "") || null, address: match[2]!.trim() };
			}
			return { name: null, address: part };
		});
}

/**
 * Fill, Link, Review and create: docs/editors.md section 4. A template with
 * no declared inputs skips straight to Link, because a step with nothing on
 * it is not a step, it is a confirmation nobody asked for.
 */
export function UseMailTemplateScreen({ template, onBack, onCreated }: UseMailTemplateScreenProps) {
	const hasInputs = template.inputs.length > 0;
	const stepDefs: (FormStep & { key: "fill" | "link" | "review" })[] = [
		...(hasInputs
			? [
					{
						key: "fill" as const,
						label: "Fill",
						hint: "What this template asks for, beyond your client and project records.",
					},
				]
			: []),
		{
			key: "link" as const,
			label: "Link",
			hint: "Linking a client fills the client placeholders. Leave it out and they stay marked as missing, which is fine if that is deliberate.",
		},
		{
			key: "review" as const,
			label: "Review",
			hint: "What the message says, and what still needs a value.",
		},
	];

	const [step, setStep] = useState(0);
	const currentKey = stepDefs[Math.min(step, stepDefs.length - 1)]!.key;
	const isLastStep = step >= stepDefs.length - 1;

	const [values, setValues] = useState<Record<string, string>>({});
	const [clients, setClients] = useState<ClientSummary[]>([]);
	// Keyed to the client it was fetched for: a client switch does not need an
	// effect to clear the stale list, the stale list just stops matching.
	const [projectsState, setProjectsState] = useState<{ clientId: string; rows: ProjectSummary[] } | null>(null);
	const [accounts, setAccounts] = useState<MailAccount[]>([]);
	const [clientId, setClientId] = useState("");
	const [projectIdChoice, setProjectIdChoice] = useState("");
	const [accountId, setAccountId] = useState("");
	// null until the person types their own address; until then "to" is
	// derived from the linked client below, with no effect keeping it in sync.
	const [typedTo, setTypedTo] = useState<string | null>(null);

	// Keyed to the inputs it was rendered from, so a change does not need an
	// effect to clear the stale render: it just stops matching and the view
	// falls back to "Rendering." below.
	const [reviewRender, setReviewRender] = useState<ReviewRenderState | null>(null);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdDraft, setCreatedDraft] = useState<MailOutboxMessage | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.clients.list({ limit: 200 }), window.juno.mail.accounts.list()])
			.then(([clientRows, accountRows]) => {
				if (cancelled) return;
				setClients(clientRows);
				setAccounts(accountRows);
				setAccountId((current) => current || accountRows.find((a) => a.smtpHost)?.id || accountRows[0]?.id || "");
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!clientId) return;
		let cancelled = false;
		window.juno.projects
			.list({ clientId })
			.then((rows) => {
				if (!cancelled) setProjectsState({ clientId, rows });
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	const projects = clientId && projectsState?.clientId === clientId ? projectsState.rows : [];
	// The person's choice holds while a client is picked; clearing the client
	// clears it too, without an effect to do it.
	const projectId = clientId ? projectIdChoice : "";

	// "To" comes from the linked client's primary address until the person
	// types their own; after that, their choice is the one that holds.
	const linkedClient = clients.find((c) => c.id === clientId);
	const to = typedTo ?? linkedClient?.email ?? "";

	useEffect(() => {
		if (currentKey !== "review") return;
		let cancelled = false;
		const key: ReviewRequestKey = { templateId: template.id, clientId, projectId, values };
		window.juno.mail.templates
			.render({ templateId: template.id, clientId: clientId || null, projectId: projectId || null, extras: values })
			.then((result) => {
				if (cancelled) return;
				setReviewRender({ ...key, status: "ready", result });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setReviewRender({ ...key, status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [currentKey, template.id, clientId, projectId, values]);

	const reviewKey: ReviewRequestKey = { templateId: template.id, clientId, projectId, values };

	const currentReview = reviewRender && sameReviewKey(reviewRender, reviewKey) ? reviewRender : null;
	const rendered = currentReview?.status === "ready" ? currentReview.result : null;
	const renderError = currentReview?.status === "error" ? currentReview.message : null;

	async function create() {
		if (creating || !rendered) return;
		setCreating(true);
		setError(null);
		try {
			const draft = await window.juno.mail.outbox.createDraft({
				accountId,
				to: parseAddressLine(to),
				subject: rendered.subject,
				bodyText: rendered.bodyText,
				bodyHtml: rendered.bodyHtml,
				clientId: clientId || null,
				projectId: projectId || null,
				templateId: template.id,
			});
			setCreatedDraft(draft);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setCreating(false);
		}
	}

	if (createdDraft) {
		return (
			<FormPage title={template.name} onBack={onCreated} backLabel="Done" width="wide">
				<p className="text-[var(--ink)]">
					Draft created. It waits in the outbox until you send it; nothing has gone out yet.
				</p>
			</FormPage>
		);
	}

	const missingInputKeys = rendered
		? rendered.missing.filter((path) => path.startsWith("document.")).map((path) => path.slice("document.".length))
		: [];

	return (
		<FormPage
			title={`Use ${template.name}`}
			onBack={onBack}
			width="wide"
			steps={stepDefs}
			step={step}
			onStep={setStep}
			actions={
				<>
					{step > 0 ? <Button onClick={() => setStep(step - 1)}>Previous</Button> : null}
					{isLastStep ? (
						<Button
							variant="primary"
							disabled={creating || !rendered || !to.trim() || !accountId}
							title={!to.trim() ? "Add a recipient on the Link step first." : undefined}
							onClick={() => void create()}
						>
							{creating ? "Creating" : "Create draft"}
						</Button>
					) : (
						<Button variant="primary" onClick={() => setStep(step + 1)}>
							Next
						</Button>
					)}
				</>
			}
		>
			{error ? (
				<p role="alert" data-selectable className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}

			{currentKey === "fill" ? (
				<TemplateInputFields
					inputs={template.inputs}
					values={values}
					onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
					missing={missingInputKeys}
					disabled={creating}
				/>
			) : currentKey === "link" ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Select
						label="Client"
						value={clientId}
						onChange={(value) => setClientId(value)}
						placeholder="Nobody"
						options={clients.map((c) => ({ value: c.id, label: c.name }))}
						help="Fills the client placeholders in the body."
					/>
					<Select
						label="Project"
						value={projectId}
						onChange={setProjectIdChoice}
						placeholder="None"
						disabled={!clientId}
						options={projects.map((p) => ({ value: p.id, label: p.name }))}
					/>
					<Select
						label="Send from"
						value={accountId}
						onChange={setAccountId}
						options={accounts.map((a) => ({ value: a.id, label: a.smtpHost ? a.email : `${a.email} (cannot send)` }))}
					/>
					<Field
						label="To"
						value={to}
						onChange={(value) => setTypedTo(value)}
						placeholder="laura@obet.be"
						help={clientId ? "Filled in from the client's primary address. Edit it if this goes somewhere else." : "Pick a client to fill this in, or type an address."}
						required
					/>
				</div>
			) : (
				<div>
					{renderError ? (
						<p role="alert" data-selectable className="mb-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
							{renderError}
						</p>
					) : null}
					{rendered ? (
						<>
							<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Subject</p>
							<p className="font-[var(--weight-medium)]">{rendered.subject}</p>
							{rendered.missing.length > 0 ? (
								<p className="mt-2 text-[length:var(--text-sm)] text-[var(--risk)]">
									No value for: {rendered.missing.join(", ")}. You can still create the draft; a blank one is sometimes correct.
								</p>
							) : null}
							<div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)]">
								<iframe
									title="Message preview"
									srcDoc={rendered.bodyHtml}
									sandbox=""
									referrerPolicy="no-referrer"
									className="block h-[420px] w-full bg-[var(--surface)]"
								/>
							</div>
						</>
					) : renderError ? null : (
						<p className="text-[var(--ink-muted)]">Rendering.</p>
					)}
				</div>
			)}
		</FormPage>
	);
}
