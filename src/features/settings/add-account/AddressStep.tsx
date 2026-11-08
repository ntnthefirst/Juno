import { useId } from "react";
import { mailProvider } from "@shared/mail-providers";
import type { MailAutoconfig } from "@shared/types";
import { Icon } from "../../../components/Icon";
import { ProviderLogo } from "./ProviderLogo";
import { CONTROL, LABEL } from "./server-values";

/** Where the DNS question stands for an address the table does not know. */
export type Lookup =
	| { state: "idle" }
	| { state: "looking" }
	| { state: "found" }
	| { state: "unknown" }
	| { state: "failed"; message: string };

type AddressStepProps = {
	email: string;
	onEmail: (email: string) => void;
	/** What the address, or the tile picked, gives. Null until it looks like an address. */
	config: MailAutoconfig | null;
	/** True when the person picked a tile, so the card says that rather than "Recognised". */
	picked: boolean;
	lookup: Lookup;
	error: string | null;
	onSubmit: () => void;
};

/**
 * The person types only the address. A provider card shows the moment the
 * offline table knows the domain; for any other domain Next asks DNS first and
 * the card says so, and that nothing else left the machine (decision 31).
 */
export function AddressStep({ email, onEmail, config, picked, lookup, error, onSubmit }: AddressStepProps) {
	const id = useId();
	const errorId = `${id}-error`;
	const domain = config?.domain ?? "";
	const showCard = config !== null && (config.source !== "convention" || lookup.state === "unknown");

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div>
				<label htmlFor={id} className={LABEL}>
					Address
				</label>
				<div className="relative">
					<Icon
						name="mail"
						size={16}
						className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink)]"
					/>
					<input
						id={id}
						type="email"
						value={email}
						autoFocus
						autoComplete="email"
						spellCheck={false}
						placeholder="hallo@example.be"
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? errorId : undefined}
						onChange={(event) => onEmail(event.target.value)}
						className={`${CONTROL} w-full pl-9${error ? " !border-[var(--risk)]" : ""}`}
					/>
				</div>
				{error ? (
					<p id={errorId} role="alert" data-selectable className="mt-1 text-sm text-[var(--risk)]">
						{error}
					</p>
				) : null}
			</div>

			{showCard && config ? <ProviderCard config={config} picked={picked} /> : null}

			{lookup.state === "found" || lookup.state === "unknown" ? (
				<p className="flex items-start gap-2 text-sm text-[var(--ink-muted)]">
					<Icon name="info" size={14} className="mt-0.5 flex-none text-[var(--ink)]" />
					<span>
						{lookup.state === "found"
							? `Found by asking DNS, the internet's address book, who handles mail for ${domain}. Nothing else is sent.`
							: `Juno asked DNS, the internet's address book, who handles mail for ${domain}, and did not know the answer. Nothing else is sent.`}
					</span>
				</p>
			) : null}
			{lookup.state === "looking" ? (
				<p role="status" className="text-sm text-[var(--ink-muted)]">
					Asking DNS who handles mail for {domain}.
				</p>
			) : null}
			{lookup.state === "failed" ? (
				<p role="alert" data-selectable className="text-sm text-[var(--ink-muted)]">
					{lookup.message} Next tries imap.{domain} and smtp.{domain}.
				</p>
			) : null}
			{/* Enter submits, the same as Next in the footer. */}
			<button type="submit" hidden aria-hidden tabIndex={-1} />
		</form>
	);
}

type ProviderCardProps = {
	config: MailAutoconfig;
	picked: boolean;
};

function ProviderCard({ config, picked }: ProviderCardProps) {
	const provider = mailProvider(config.provider);
	const name = config.providerName ?? provider?.name ?? null;
	const hosts = `${config.imapHost} and ${config.smtpHost}`;
	const badge =
		config.source === "convention" ? null : config.source === "mx" ? "Found" : picked ? "Picked" : "Recognised";

	let line: string;
	if (config.source === "convention") {
		line = `Juno does not know who handles mail for ${config.domain}, so it will try ${hosts}. Check them under Server settings on the next step.`;
	} else if (config.source === "mx") {
		line = `${config.domain} has its mail at ${name}, so Juno uses ${hosts}.`;
	} else if (config.signIn === "app-password") {
		line = `${hosts}. ${name} asks for an app password; the next step shows how.`;
	} else if (config.signIn === "microsoft") {
		line = `${hosts}. ${name} signs in through Microsoft on the next step.`;
	} else {
		line = `${hosts}. The next step asks for your password.`;
	}

	return (
		<div
			data-provider-card={config.provider ?? config.source}
			className="flex animate-rise items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3.5"
		>
			<ProviderLogo provider={provider} name={name} icon={name ? undefined : "mail"} size={36} />
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-2">
					<span className="text-base font-[var(--weight-semibold)] text-[var(--ink)]">
						{name ?? config.domain}
					</span>
					{badge ? (
						<span className="rounded-[var(--radius-sm)] bg-[var(--ok-soft)] px-2 py-0.5 text-micro text-[var(--ok)]">
							{badge}
						</span>
					) : null}
				</p>
				<p className="mt-0.5 text-sm text-[var(--ink-muted)]">{line}</p>
			</div>
		</div>
	);
}
