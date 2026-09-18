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
	};
}

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
	const [busy, setBusy] = useState<"save" | "test" | null>(null);

	const set = <K extends keyof Values>(key: K, value: Values[K]) => {
		setValues((current) => ({ ...current, [key]: value }));
		setTestResult(null);
	};

	function numbers(): { imapPort: number; horizonDays: number; syncIntervalMinutes: number } {
		return {
			imapPort: Number(values.imapPort),
			horizonDays: Number(values.horizonDays),
			syncIntervalMinutes: Number(values.syncIntervalMinutes),
		};
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
					<Button disabled={busy !== null} onClick={() => void test()}>
						{busy === "test" ? "Testing" : "Test connection"}
					</Button>
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
