import { useState, type FormEvent } from "react";
import type { MailAccount, MailAccountInput, MailAccountPatch, MailSecurity } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
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
export function MailAccountForm({ account, onClose, onSaved }: MailAccountFormProps) {
	const [values, setValues] = useState<Values>(() => toValues(account));
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
			const result = await window.bureau.mail.accounts.testSmtp({
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
			const result = await window.bureau.mail.accounts.test({
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
				saved = await window.bureau.mail.accounts.update(account.id, patch);
			} else {
				const input: MailAccountInput = { ...base, password: values.password };
				saved = await window.bureau.mail.accounts.create(input);
			}
			set("password", "");
			onSaved(saved);
		} catch (cause: unknown) {
			setError(messageOf(cause));
			setBusy(null);
		}
	}

	return (
		<Dialog title={account ? "Edit mail account" : "Add mail account"} onClose={onClose}>
			<form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-4">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field
						label="Address"
						type="email"
						value={values.email}
						onChange={(v) => set("email", v)}
						required
						placeholder="hallo@example.be"
					/>
					<Field
						label="Label"
						value={values.label}
						onChange={(v) => set("label", v)}
						placeholder="Defaults to the address"
					/>
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
					<Field
						label={account?.hasCredential ? "Password (set, type to replace)" : "Password"}
						type="password"
						value={values.password}
						onChange={(v) => set("password", v)}
						required={!account}
					/>
					<div />
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
				</div>
				<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					The horizon bounds the first sync of each folder. Raise it later to pull older mail.
					The password is stored in the operating system keychain and never shown again.
				</p>

				<div className="border-t border-[var(--line)] pt-4">
					<h3 className="text-[length:var(--text-base)] font-[var(--weight-medium)]">Sending</h3>
					<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Leave the server empty for an account you only read. The same password is used;
						fill in a username only if the provider wants a different one for sending.
					</p>
					<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
						<Field label="Port" type="number" value={values.smtpPort} onChange={(v) => set("smtpPort", v)} tabular />
						<Field
							label="Username for sending"
							value={values.smtpUsername}
							onChange={(v) => set("smtpUsername", v)}
							placeholder="Same as above"
						/>
						<Field
							label="Sender name"
							value={values.fromName}
							onChange={(v) => set("fromName", v)}
							placeholder="Defaults to your name in Settings"
						/>
					</div>
					{smtpResult ? (
						<p
							role="status"
							data-selectable
							className={`mt-3 border-l-2 pl-3 text-[length:var(--text-sm)] ${
								smtpResult.ok ? "border-[var(--ok)] text-[var(--ok)]" : "border-[var(--risk)] text-[var(--risk)]"
							}`}
						>
							{smtpResult.message}
						</p>
					) : null}
				</div>

				{testResult ? (
					<p
						role="status"
						data-selectable
						className={`border-l-2 pl-3 text-[length:var(--text-sm)] ${
							testResult.ok
								? "border-[var(--ok)] text-[var(--ok)]"
								: "border-[var(--risk)] text-[var(--risk)]"
						}`}
					>
						{testResult.message}
					</p>
				) : null}
				{error ? (
					<p role="alert" data-selectable className="border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]">
						{error}
					</p>
				) : null}

				<div className="flex items-center justify-between gap-3">
					<div className="flex gap-2">
						<Button disabled={busy !== null} onClick={() => void test()}>
							{busy === "test" ? "Testing" : "Test incoming"}
						</Button>
						<Button disabled={busy !== null || !values.smtpHost.trim()} onClick={() => void testSmtp()}>
							{busy === "smtp" ? "Testing" : "Test outgoing"}
						</Button>
					</div>
					<div className="flex gap-2">
						<Button onClick={onClose}>Cancel</Button>
						<Button type="submit" variant="primary" disabled={busy !== null}>
							{busy === "save" ? "Saving" : account ? "Save" : "Add account"}
						</Button>
					</div>
				</div>
			</form>
		</Dialog>
	);
}
