import { useId } from "react";
import type { MailSecurity } from "@shared/types";
import { CONTROL, LABEL, portFor, type ServerValues } from "./server-values";

type ServerFieldsProps = {
	values: ServerValues;
	onChange: (next: ServerValues) => void;
	/** Shown in the user name field while it is empty. */
	email: string;
	disabled?: boolean;
};

/**
 * Incoming, outgoing and the user name, as the Set up by hand frame draws
 * them: a host, a port and the security on one row per direction. The same
 * fields open under "Server settings" on the sign-in step.
 */
export function ServerFields({ values, onChange, email, disabled = false }: ServerFieldsProps) {
	const userId = useId();
	return (
		<div className="flex flex-col gap-4">
			<ServerRow
				label="Incoming mail (IMAP)"
				direction="imap"
				host={values.imapHost}
				port={values.imapPort}
				security={values.imapSecurity}
				placeholder="imap.example.be"
				disabled={disabled}
				onChange={(host, port, security) =>
					onChange({ ...values, imapHost: host, imapPort: port, imapSecurity: security })
				}
			/>
			<ServerRow
				label="Outgoing mail (SMTP)"
				direction="smtp"
				host={values.smtpHost}
				port={values.smtpPort}
				security={values.smtpSecurity}
				placeholder="smtp.example.be"
				disabled={disabled}
				onChange={(host, port, security) =>
					onChange({ ...values, smtpHost: host, smtpPort: port, smtpSecurity: security })
				}
			/>
			<div>
				<label htmlFor={userId} className={LABEL}>
					User name
				</label>
				<input
					id={userId}
					value={values.username}
					disabled={disabled}
					placeholder={email.trim() ? `Same as the address (${email.trim()})` : "Same as the address"}
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => onChange({ ...values, username: event.target.value })}
					className={`${CONTROL} w-full`}
				/>
			</div>
		</div>
	);
}

type ServerRowProps = {
	label: string;
	direction: "imap" | "smtp";
	host: string;
	port: string;
	security: MailSecurity;
	placeholder: string;
	disabled: boolean;
	onChange: (host: string, port: string, security: MailSecurity) => void;
};

function ServerRow({ label, direction, host, port, security, placeholder, disabled, onChange }: ServerRowProps) {
	const id = useId();
	return (
		<div role="group" aria-labelledby={id}>
			<span id={id} className={LABEL}>
				{label}
			</span>
			<div className="flex items-end gap-2">
				<input
					aria-label={`${label} server`}
					value={host}
					disabled={disabled}
					placeholder={placeholder}
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => onChange(event.target.value, port, security)}
					className={`${CONTROL} min-w-0 flex-1 font-mono text-sm`}
				/>
				<input
					aria-label={`${label} port`}
					value={port}
					disabled={disabled}
					inputMode="numeric"
					onChange={(event) => onChange(host, event.target.value.replace(/\D/g, ""), security)}
					className={`${CONTROL} tabular w-[80px] flex-none font-mono text-sm`}
				/>
				<select
					aria-label={`${label} security`}
					value={security}
					disabled={disabled}
					onChange={(event) => {
						const next = event.target.value as MailSecurity;
						onChange(host, portFor(direction, next, port), next);
					}}
					className={`${CONTROL} w-[130px] flex-none`}
				>
					<option value="tls">SSL/TLS</option>
					<option value="starttls">STARTTLS</option>
				</select>
			</div>
		</div>
	);
}
