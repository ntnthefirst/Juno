import { useId, useState, type FormEvent } from "react";
import type { MailAccount, MailConnectResult } from "@shared/types";
import { Button } from "../../../components/Button";
import { FormPage } from "../../../components/FormPage";
import { messageOf } from "../../../lib/errors";
import { ReadyStep } from "./ReadyStep";
import { ServerFields } from "./ServerFields";
import { CONTROL, EMPTY_SERVERS, inputFrom, LABEL, type ServerValues } from "./server-values";

type ByHandPageProps = {
	/** Starts from what an earlier step filled in, when there was one. */
	initialEmail: string;
	initialServers: ServerValues | null;
	onBack: () => void;
	onClose: () => void;
	onSaved: (account: MailAccount) => void;
};

/**
 * For a server Juno does not know: every field, and "Test and connect", which
 * adds the account only when receiving and sending both work.
 */
export function ByHandPage({ initialEmail, initialServers, onBack, onClose, onSaved }: ByHandPageProps) {
	const formId = useId();
	const emailId = useId();
	const [email, setEmail] = useState(initialEmail);
	const [password, setPassword] = useState("");
	const [servers, setServers] = useState<ServerValues>(initialServers ?? EMPTY_SERVERS);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<MailConnectResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const complete = email.trim() && password && servers.imapHost.trim() && servers.smtpHost.trim() && servers.imapPort && servers.smtpPort;

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy || !complete) return;
		setBusy(true);
		setError(null);
		setResult(null);
		try {
			const outcome = await window.juno.mail.accounts.connect({ ...inputFrom(email, servers), password });
			setResult(outcome);
			if (outcome.account) {
				setPassword("");
				onSaved(outcome.account);
			}
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<FormPage
			title="Set up by hand"
			description="For a server Juno does not know. Your host's help pages list these."
			onBack={onClose}
			backLabel="Mail accounts"
			actions={
				<>
					<Button onClick={onBack}>Back</Button>
					<Button type="submit" form={formId} variant="primary" disabled={busy || !complete}>
						{busy ? "Testing" : "Test and connect"}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
				<div role="group" aria-labelledby={emailId}>
					<span id={emailId} className={LABEL}>
						Address and password
					</span>
					<div className="flex items-end gap-2">
						<input
							aria-label="Address"
							type="email"
							value={email}
							autoFocus
							autoComplete="email"
							spellCheck={false}
							placeholder="hallo@example.be"
							onChange={(event) => setEmail(event.target.value)}
							className={`${CONTROL} min-w-0 flex-1`}
						/>
						<input
							aria-label="Password"
							type="password"
							value={password}
							autoComplete="off"
							onChange={(event) => setPassword(event.target.value)}
							className={`${CONTROL} w-[200px] flex-none`}
						/>
					</div>
				</div>
				<ServerFields values={servers} onChange={setServers} email={email} />
				{/* A result that saved closes the page, so one drawn here is a failure to read. */}
				{result ? (
					<ReadyStep
						result={result}
						hosts={{ imap: servers.imapHost, smtp: servers.smtpHost }}
						mail
						onMail={() => undefined}
						error={null}
					/>
				) : null}
				{error ? (
					<p role="alert" data-selectable className="border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
						{error}
					</p>
				) : null}
			</form>
		</FormPage>
	);
}
