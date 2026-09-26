import { useId, useState, type FormEvent } from "react";
import type {
	MailAccount,
	MailAccountInput,
	MailAccountPatch,
	MailAutoconfig,
	MailSecurity,
} from "@shared/types";
import { Button } from "../../components/Button";
import { FormPage, type FormStep } from "../../components/FormPage";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { messageOf } from "../../lib/errors";

type MailAccountFormProps = {
	/** Null adds, an account edits. */
	account: MailAccount | null;
	onClose: () => void;
	onSaved: (account: MailAccount) => void;
};

type Values = {
	label: string;
	email: string;
	imapHost: string;
	imapPort: string;
	imapSecurity: MailSecurity;
	username: string;
	password: string;
	horizonDays: string;
	syncIntervalMinutes: string;
	smtpHost: string;
	smtpPort: string;
	smtpSecurity: MailSecurity;
	smtpUsername: string;
	fromName: string;
};

function toValues(account: MailAccount | null): Values {
	return {
		label: account?.label ?? "",
		email: account?.email ?? "",
		imapHost: account?.imapHost ?? "",
		imapPort: String(account?.imapPort ?? 993),
		imapSecurity: account?.imapSecurity ?? "tls",
		username: account?.username ?? "",
		// Never prefilled. The renderer does not have it and never will.
		password: "",
		horizonDays: String(account?.horizonDays ?? 90),
		syncIntervalMinutes: String(account?.syncIntervalMinutes ?? 10),
		smtpHost: account?.smtpHost ?? "",
		smtpPort: String(account?.smtpPort ?? 465),
		smtpSecurity: account?.smtpSecurity ?? "tls",
		smtpUsername: account?.smtpUsername ?? "",
		fromName: account?.fromName ?? "",
	};
}

const SMTP_SECURITY_OPTIONS: { value: MailSecurity; label: string }[] = [
	{ value: "tls", label: "TLS (port 465)" },
	{ value: "starttls", label: "STARTTLS (port 587)" },
];

const SECURITY_OPTIONS: { value: MailSecurity; label: string }[] = [
	{ value: "tls", label: "TLS (port 993)" },
	{ value: "starttls", label: "STARTTLS (port 143)" },
];

/**
 * The password is a one-way field. It posts to the main process on save and
 * the form clears it; editing an existing account shows "set" and an empty
 * field that only replaces the stored password when something is typed.
 */
const STEPS: FormStep[] = [
	{ label: "Address", hint: "Your address and its password. Juno works the servers out from there." },
	{ label: "Servers", hint: "Check these, then test them before saving." },
	{ label: "Sync", hint: "How much mail to pull, and how often." },
];

export function MailAccountForm({ account, onClose, onSaved }: MailAccountFormProps) {
	const [values, setValues] = useState<Values>(() => toValues(account));
	// An account being edited already has its servers, so it opens on them.
	const [step, setStep] = useState(account ? 1 : 0);
	const [guessed, setGuessed] = useState<MailAutoconfig | null>(null);
	const [lookingUp, setLookingUp] = useState(false);
	const [lookupNote, setLookupNote] = useState<string | null>(null);
	const [emailError, setEmailError] = useState<string | null>(null);
	// The submit button lives in the page footer, outside the form element.
	const formId = useId();
	const [error, setError] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
	const [smtpResult, setSmtpResult] = useState<{ ok: boolean; message: string } | null>(null);
	const [busy, setBusy] = useState<"save" | "test" | "smtp" | null>(null);

	const set = <K extends keyof Values>(key: K, value: Values[K]) => {
		setValues((current) => ({ ...current, [key]: value }));
		setTestResult(null);
	};

	function numbers(): { imapPort: number; horizonDays: number; syncIntervalMinutes: number; smtpPort: number } {
		return {
			imapPort: Number(values.imapPort),
			horizonDays: Number(values.horizonDays),
			syncIntervalMinutes: Number(values.syncIntervalMinutes),
			smtpPort: Number(values.smtpPort),
		};
	}

	async function testSmtp() {
		setBusy("smtp");
		setError(null);
		try {
			const result = await window.juno.mail.accounts.testSmtp({
				...(account ? { id: account.id } : {}),
				smtpHost: values.smtpHost,
				smtpPort: numbers().smtpPort,
				smtpSecurity: values.smtpSecurity,
				smtpUsername: values.smtpUsername || null,
				username: values.username || values.email,
				...(values.password ? { password: values.password } : {}),
			});
			setSmtpResult({
				ok: result.ok,
				message: result.ok ? "Connected and signed in. Nothing was sent." : (result.message ?? "The connection failed."),
			});
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	async function test() {
		setBusy("test");
		setError(null);
		try {
			const result = await window.juno.mail.accounts.test({
				...(account ? { id: account.id } : {}),
				imapHost: values.imapHost,
				imapPort: numbers().imapPort,
				imapSecurity: values.imapSecurity,
				username: values.username || values.email,
				...(values.password ? { password: values.password } : {}),
			});
			setTestResult({
				ok: result.ok,
				message: result.ok
					? `Connected. ${result.folderCount} ${result.folderCount === 1 ? "folder" : "folders"} found.`
					: (result.message ?? "The connection failed."),
			});
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(null);
		}
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;
		setBusy("save");
		setError(null);
		try {
			const base = {
				label: values.label,
				email: values.email,
				imapHost: values.imapHost,
				imapSecurity: values.imapSecurity,
				username: values.username,
				smtpHost: values.smtpHost.trim() || null,
				smtpSecurity: values.smtpSecurity,
				smtpUsername: values.smtpUsername.trim() || null,
				fromName: values.fromName.trim() || null,
				...numbers(),
			};
			let saved: MailAccount;
			if (account) {
				const patch: MailAccountPatch = {
					...base,
					...(values.password ? { password: values.password } : {}),
				};
				saved = await window.juno.mail.accounts.update(account.id, patch);
			} else {
				const input: MailAccountInput = { ...base, password: values.password };
				saved = await window.juno.mail.accounts.create(input);
			}
			set("password", "");
			onSaved(saved);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(null);
		}
	}


	/**
	 * Fills the server fields in from the address.
	 *
	 * Only ever on the way forward out of the first step, and only over fields
	 * nobody has filled in by hand: re-guessing on top of a host someone typed
	 * is how a form argues with the person using it.
	 */
	async function fillFromAddress(): Promise<boolean> {
		const email = values.email.trim();
		if (email.length === 0) {
			setEmailError("Enter your email address.");
			return false;
		}
		setEmailError(null);

		try {
			const result = await window.juno.mail.accounts.guess(email);
			setGuessed(result);
			setValues((current) => ({
				...current,
				imapHost: current.imapHost.trim() || result.imapHost,
				imapPort: current.imapHost.trim() ? current.imapPort : String(result.imapPort),
				imapSecurity: current.imapHost.trim() ? current.imapSecurity : result.imapSecurity,
				smtpHost: current.smtpHost.trim() || result.smtpHost,
				smtpPort: current.smtpHost.trim() ? current.smtpPort : String(result.smtpPort),
				smtpSecurity: current.smtpHost.trim() ? current.smtpSecurity : result.smtpSecurity,
			}));
			return true;
		} catch (cause: unknown) {
			setEmailError(messageOf(cause));
			return false;
		}
	}

	/**
	 * Asks DNS who actually handles mail for the domain.
	 *
	 * Offered rather than automatic: it is the one part of adding an account
	 * that leaves this machine, and the convention guess is right often enough
	 * that making every person pay for a lookup would be rude.
	 */
	async function lookUp() {
		setLookingUp(true);
		setLookupNote(null);
		try {
			const found = await window.juno.mail.accounts.lookUp(values.email.trim());
			if (!found) {
				setLookupNote(
					"That domain's mail host is not one Juno recognises, so the settings below are still the best guess. Test them.",
				);
				return;
			}
			setGuessed(found);
			setValues((current) => ({
				...current,
				imapHost: found.imapHost,
				imapPort: String(found.imapPort),
				imapSecurity: found.imapSecurity,
				smtpHost: found.smtpHost,
				smtpPort: String(found.smtpPort),
				smtpSecurity: found.smtpSecurity,
			}));
			setTestResult(null);
			setSmtpResult(null);
		} catch (cause: unknown) {
			setLookupNote(messageOf(cause));
		} finally {
			setLookingUp(false);
		}
	}

	async function goNext() {
		if (step === 0 && !(await fillFromAddress())) return;
		setStep(step + 1);
	}

	const last = step === STEPS.length - 1;

	return (
		<FormPage
			title={account ? "Edit mail account" : "Add mail account"}
			onBack={onClose}
			backLabel="Mail accounts"
			steps={STEPS}
			step={step}
			onStep={setStep}
			actions={
				<>
					{step > 0 ? <Button onClick={() => setStep(step - 1)}>Previous</Button> : null}
					{last ? null : (
						<Button
							variant={account ? "quiet" : "primary"}
							disabled={busy !== null}
							onClick={() => void goNext()}
						>
							Next
						</Button>
					)}
					{last || account ? (
						<Button type="submit" form={formId} variant="primary" disabled={busy !== null}>
							{busy === "save" ? "Saving" : account ? "Save" : "Add account"}
						</Button>
					) : null}
				</>
			}
		>
			<form id={formId} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
				{step === 0 ? (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="sm:col-span-2">
							<Field
								label="Address"
								type="email"
								value={values.email}
								onChange={(v) => {
									set("email", v);
									setEmailError(null);
								}}
								error={emailError}
								required
								placeholder="hallo@example.be"
							/>
						</div>
						<div className="sm:col-span-2">
							<Field
								label={account?.hasCredential ? "Password (set, type to replace)" : "Password"}
								type="password"
								value={values.password}
								onChange={(v) => set("password", v)}
								required={!account}
							/>
						</div>
						<div className="sm:col-span-2">
							<Field
								label="Label"
								value={values.label}
								onChange={(v) => set("label", v)}
								placeholder="Defaults to the address"
							/>
						</div>
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)] sm:col-span-2">
							The password goes into the operating system keychain and is never shown again.
						</p>
					</div>
				) : step === 1 ? (
					<>
						{guessed ? (
							<div className="border-l-2 border-[var(--accent)] pl-3">
								<p className="text-[length:var(--text-sm)]">
									{guessed.source === "known"
										? `Filled in from the known settings for ${guessed.domain}.`
										: guessed.source === "mx"
											? `${guessed.domain} has its mail at ${guessed.imapHost.replace(/^imap\./, "")}, so these come from there.`
											: `Nothing on file for ${guessed.domain}, so these follow the usual naming. Test them before you save.`}
								</p>
								{guessed.note ? (
									<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
										{guessed.note}
									</p>
								) : null}
								{guessed.source === "convention" ? (
									<div className="mt-2 flex items-center gap-3">
										<Button size="dense" disabled={lookingUp} onClick={() => void lookUp()}>
											{lookingUp ? "Looking up" : "Look up the real host"}
										</Button>
										<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											Asks DNS who handles mail for {guessed.domain}. The only step that
											leaves this machine.
										</span>
									</div>
								) : null}
								{lookupNote ? (
									<p
										data-selectable
										className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
									>
										{lookupNote}
									</p>
								) : null}
							</div>
						) : null}

						<div>
							<h3 className="text-[length:var(--text-base)] font-[var(--weight-medium)]">Receiving</h3>
							<div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Field
									label="IMAP server"
									value={values.imapHost}
									onChange={(v) => set("imapHost", v)}
									required
									placeholder="imap.example.be"
								/>
								<Select
									label="Security"
									value={values.imapSecurity}
									onChange={(v) => {
										const security = v as MailSecurity;
										setValues((current) => ({
											...current,
											imapSecurity: security,
											imapPort:
												current.imapPort === "993" || current.imapPort === "143"
													? security === "tls"
														? "993"
														: "143"
													: current.imapPort,
										}));
										setTestResult(null);
									}}
									options={SECURITY_OPTIONS}
								/>
								<Field
									label="Port"
									type="number"
									value={values.imapPort}
									onChange={(v) => set("imapPort", v)}
									tabular
								/>
								<Field
									label="Username"
									value={values.username}
									onChange={(v) => set("username", v)}
									placeholder="Defaults to the address"
								/>
							</div>
							{testResult ? (
								<p
									role="status"
									data-selectable
									className={`mt-3 border-l-2 pl-3 text-[length:var(--text-sm)] ${
										testResult.ok
											? "border-[var(--ok)] text-[var(--ok)]"
											: "border-[var(--risk)] text-[var(--risk)]"
									}`}
								>
									{testResult.message}
								</p>
							) : null}
						</div>

						<div className="border-t border-[var(--line)] pt-4">
							<h3 className="text-[length:var(--text-base)] font-[var(--weight-medium)]">Sending</h3>
							<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								Leave the server empty for an account you only read.
							</p>
							<div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Field
									label="SMTP server"
									value={values.smtpHost}
									onChange={(v) => set("smtpHost", v)}
									placeholder="smtp.example.be"
								/>
								<Select
									label="Security"
									value={values.smtpSecurity}
									onChange={(v) => {
										const security = v as MailSecurity;
										setValues((current) => ({
											...current,
											smtpSecurity: security,
											smtpPort:
												current.smtpPort === "465" || current.smtpPort === "587"
													? security === "tls"
														? "465"
														: "587"
													: current.smtpPort,
										}));
										setSmtpResult(null);
									}}
									options={SMTP_SECURITY_OPTIONS}
								/>
								<Field
									label="Port"
									type="number"
									value={values.smtpPort}
									onChange={(v) => set("smtpPort", v)}
									tabular
								/>
								<Field
									label="Username for sending"
									value={values.smtpUsername}
									onChange={(v) => set("smtpUsername", v)}
									placeholder="Same as above"
								/>
							</div>
							{smtpResult ? (
								<p
									role="status"
									data-selectable
									className={`mt-3 border-l-2 pl-3 text-[length:var(--text-sm)] ${
										smtpResult.ok
											? "border-[var(--ok)] text-[var(--ok)]"
											: "border-[var(--risk)] text-[var(--risk)]"
									}`}
								>
									{smtpResult.message}
								</p>
							) : null}
						</div>

						<div className="flex gap-2">
							<Button disabled={busy !== null} onClick={() => void test()}>
								{busy === "test" ? "Testing" : "Test incoming"}
							</Button>
							<Button
								disabled={busy !== null || !values.smtpHost.trim()}
								onClick={() => void testSmtp()}
							>
								{busy === "smtp" ? "Testing" : "Test outgoing"}
							</Button>
						</div>
					</>
				) : (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field
							label="Sync horizon (days)"
							type="number"
							value={values.horizonDays}
							onChange={(v) => set("horizonDays", v)}
							tabular
						/>
						<Field
							label="Sync every (minutes)"
							type="number"
							value={values.syncIntervalMinutes}
							onChange={(v) => set("syncIntervalMinutes", v)}
							tabular
						/>
						<div className="sm:col-span-2">
							<Field
								label="Sender name"
								value={values.fromName}
								onChange={(v) => set("fromName", v)}
								placeholder="Defaults to your name in Settings"
							/>
						</div>
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)] sm:col-span-2">
							How far back the first sync goes. Raise it later for older mail.
						</p>
					</div>
				)}

				{error ? (
					<p
						role="alert"
						data-selectable
						className="border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
					>
						{error}
					</p>
				) : null}
			</form>
		</FormPage>
	);
}
