import { useId, useState } from "react";
import { mailProvider } from "@shared/mail-providers";
import { microsoftSignInConfigured } from "@shared/oauth";
import type { MailAutoconfig } from "@shared/types";
import { Button } from "../../../components/Button";
import { Icon } from "../../../components/Icon";
import { isMac } from "../../../lib/platform";
import { ProviderLogo } from "./ProviderLogo";
import { ServerFields } from "./ServerFields";
import { CONTROL, LABEL, summary, type ServerValues } from "./server-values";

type SignInStepProps = {
	email: string;
	config: MailAutoconfig;
	servers: ServerValues;
	onServers: (next: ServerValues) => void;
	/** Open the server settings from the start, when the servers are only a guess. */
	serversOpen: boolean;
	password: string;
	onPassword: (value: string) => void;
	/** Connect, from Enter in the password field. */
	onSubmit: () => void;
	/** Where a Microsoft sign-in stands. */
	microsoft: "idle" | "waiting";
	onMicrosoft: () => void;
	onCancelMicrosoft: () => void;
	error: string | null;
};

const KEEPER = isMac ? "macOS" : "Windows";

/**
 * The second step, in the shape the provider needs: the app password guide
 * with a button to the provider's page, the plain password field, or Sign in
 * with Microsoft. Every route ends with the servers folded underneath.
 */
export function SignInStep({
	email,
	config,
	servers,
	onServers,
	serversOpen,
	password,
	onPassword,
	onSubmit,
	microsoft,
	onMicrosoft,
	onCancelMicrosoft,
	error,
}: SignInStepProps) {
	const provider = mailProvider(config.provider);
	const passwordId = useId();
	const [open, setOpen] = useState(serversOpen);
	const [opening, setOpening] = useState<string | null>(null);

	async function openPage() {
		if (!provider) return;
		setOpening(null);
		try {
			await window.juno.mail.accounts.openProviderPage(provider.id);
		} catch (cause: unknown) {
			setOpening(cause instanceof Error ? cause.message : String(cause));
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{config.signIn === "microsoft" ? (
				<MicrosoftCard
					email={email}
					name={config.providerName ?? provider?.name ?? "Microsoft"}
					config={config}
					state={microsoft}
					onSignIn={onMicrosoft}
					onCancel={onCancelMicrosoft}
				/>
			) : (
				<>
					{config.signIn === "app-password" && provider?.appPassword ? (
						<div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-4 py-3.5">
							<p className="flex items-center gap-2 text-base font-[var(--weight-semibold)] text-[var(--ink)]">
								<Icon name="lock" size={16} />
								{provider.appPassword.heading}
							</p>
							<ol className="flex flex-col gap-2.5">
								{provider.appPassword.steps.map((line, index) => (
									<li key={line} className="flex gap-2 text-base text-[var(--ink)]">
										<span className="tabular w-[14px] flex-none text-[var(--ink-muted)]">{index + 1}.</span>
										<span>{line}</span>
									</li>
								))}
							</ol>
							<div>
								<Button size="dense" onClick={() => void openPage()}>
									<Icon name="external" size={14} />
									{provider.appPassword.open}
								</Button>
							</div>
							{opening ? (
								<p role="alert" data-selectable className="text-sm text-[var(--risk)]">
									{opening}
								</p>
							) : null}
						</div>
					) : null}

					<form
						onSubmit={(event) => {
							event.preventDefault();
							onSubmit();
						}}
					>
						<label htmlFor={passwordId} className={LABEL}>
							{config.signIn === "app-password" ? "App password" : "Password"}
						</label>
						{/*
						 * A password field, even for an app password the frame draws in the
						 * clear: whatever reaches the screen can reach a screenshot.
						 */}
						<input
							id={passwordId}
							type="password"
							value={password}
							autoFocus
							autoComplete="off"
							spellCheck={false}
							onChange={(event) => onPassword(event.target.value)}
							className={`${CONTROL} w-full${config.signIn === "app-password" ? " font-mono text-sm" : ""}`}
						/>
						<p className="mt-1.5 text-sm text-[var(--ink-muted)]">Stored by {KEEPER} and never shown again.</p>
					</form>
				</>
			)}

			<div>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="-ml-1 flex min-h-[32px] items-center gap-2 rounded-[var(--radius-md)] px-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
				>
					<Icon
						name="chevron-right"
						size={14}
						className={`flex-none text-[var(--ink)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease)] ${open ? "rotate-90" : ""}`}
					/>
					<span className="text-base text-[var(--ink-muted)]">Server settings</span>
					<span className="tabular truncate text-sm text-[var(--ink-faint)]">{summary(servers)}</span>
				</button>
				{open ? (
					<div className="mt-3 animate-fade">
						<ServerFields values={servers} onChange={onServers} email={email} />
					</div>
				) : null}
			</div>

			{error ? (
				<p role="alert" data-selectable className="border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					{error}
				</p>
			) : null}
		</div>
	);
}

type MicrosoftCardProps = {
	email: string;
	name: string;
	config: MailAutoconfig;
	state: "idle" | "waiting";
	onSignIn: () => void;
	onCancel: () => void;
};

function MicrosoftCard({ email, name, config, state, onSignIn, onCancel }: MicrosoftCardProps) {
	const ready = microsoftSignInConfigured();
	return (
		<div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-5 py-5">
			<div className="flex items-center gap-3">
				<ProviderLogo provider={mailProvider(config.provider)} name={name} size={36} />
				<div className="min-w-0">
					<p className="truncate text-base font-[var(--weight-semibold)] text-[var(--ink)]">{email.trim()}</p>
					<p className="text-sm text-[var(--ink-muted)]">{name} signs in through Microsoft, not with a password here.</p>
				</div>
			</div>
			<p className="text-base text-[var(--ink)]">
				Your browser opens Microsoft's sign-in page. You sign in there and allow Juno to:
			</p>
			<p className="flex items-center gap-2.5 text-base text-[var(--ink)]">
				<span
					aria-hidden
					className="flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)] bg-[var(--ok-soft)] text-[var(--ink)]"
				>
					<Icon name="check" size={14} />
				</span>
				Read, file and send your mail
			</p>
			<p className="text-sm text-[var(--ink-muted)]">
				Juno never sees your password. You can take its access away at any time in your Microsoft account.
			</p>
			{ready ? null : (
				<p role="status" className="text-sm text-[var(--ink-muted)]">
					Sign-in with Microsoft is coming soon. Until then, Outlook.com and Microsoft 365 accounts cannot be added.
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button variant="primary" disabled={!ready || state === "waiting"} onClick={onSignIn}>
					<Icon name="external" size={16} />
					{state === "waiting" ? "Waiting for the browser" : "Sign in with Microsoft"}
				</Button>
				{state === "waiting" ? <Button onClick={onCancel}>Cancel</Button> : null}
			</div>
		</div>
	);
}
