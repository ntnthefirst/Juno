import { useEffect, useRef, useState } from "react";
import { mailProvider } from "@shared/mail-providers";
import type { MailAccount, MailAutoconfig, MailConnectResult, MailProviderId, MailSignInResult } from "@shared/types";
import { Button } from "../../../components/Button";
import { FormPage, type FormStep } from "../../../components/FormPage";
import { messageOf } from "../../../lib/errors";
import { AddressStep, type Lookup } from "./AddressStep";
import { ByHandPage } from "./ByHandPage";
import { ProviderPicker } from "./ProviderPicker";
import { ReadyStep } from "./ReadyStep";
import { SignInStep } from "./SignInStep";
import { EMPTY_SERVERS, inputFrom, serversFrom, type ServerValues } from "./server-values";

type AddAccountFlowProps = {
	onClose: () => void;
	/** The account was added. Called from Done, or straight away by "Test and connect". */
	onSaved: (account: MailAccount) => void;
};

type Stage = "choose" | "address" | "sign-in" | "ready" | "by-hand";

const STEPS: FormStep[] = [
	{ label: "Address", hint: "Type your address. Juno works out the rest." },
	{ label: "Sign in" },
	{ label: "Ready" },
];

const STEP_OF: Partial<Record<Stage, number>> = { address: 0, "sign-in": 1, ready: 2 };

const LOOKS_LIKE_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function domainOf(email: string): string {
	const parts = email.trim().toLowerCase().split("@");
	return parts.length === 2 ? (parts[1] ?? "") : "";
}

/**
 * Add mail account, as the frames in section 19 draw it: pick a provider,
 * type the address, sign in the way that provider wants, and see both
 * directions work before the account exists. Every call goes through
 * `window.juno.mail.accounts`; what an address means and whether the servers
 * answer is decided in the main process.
 */
export function AddAccountFlow({ onClose, onSaved }: AddAccountFlowProps) {
	const [stage, setStage] = useState<Stage>("choose");
	const [provider, setProvider] = useState<MailProviderId | null>(null);
	const [email, setEmail] = useState("");
	const [config, setConfig] = useState<MailAutoconfig | null>(null);
	const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
	const [emailError, setEmailError] = useState<string | null>(null);
	const [servers, setServers] = useState<ServerValues>(EMPTY_SERVERS);
	const [serversOpen, setServersOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [signIn, setSignIn] = useState<MailSignInResult | null>(null);
	const [microsoft, setMicrosoft] = useState<"idle" | "waiting">("idle");
	const [signInError, setSignInError] = useState<string | null>(null);
	const [result, setResult] = useState<MailConnectResult | null>(null);
	const [readyError, setReadyError] = useState<string | null>(null);
	const [mail, setMail] = useState(true);
	const [busy, setBusy] = useState(false);

	// A sign-in still waiting on the browser when this page goes away is let go.
	const waiting = useRef(false);
	useEffect(() => {
		waiting.current = microsoft === "waiting";
	}, [microsoft]);
	useEffect(
		() => () => {
			if (waiting.current) void window.juno.mail.accounts.cancelSignIn();
		},
		[],
	);

	// The card under the address follows the typing. The guess is a table in
	// the main process and touches no network, so it can run on every change.
	useEffect(() => {
		if (stage !== "address") return;
		const address = email.trim();
		if (!LOOKS_LIKE_ADDRESS.test(address)) return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			window.juno.mail.accounts
				.guess(address, provider)
				.then((next) => {
					if (cancelled) return;
					// A DNS answer for the same domain is better than the table's, so a
					// guess that lands after it does not replace it.
					setConfig((previous) =>
						previous?.source === "mx" && previous.domain === next.domain ? previous : next,
					);
				})
				.catch(() => {
					if (!cancelled) setConfig(null);
				});
		}, 120);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [email, provider, stage]);

	function start(next: MailProviderId | null) {
		setProvider(next);
		setConfig(null);
		setLookup({ state: "idle" });
		setEmailError(null);
		setStage("address");
	}

	async function nextFromAddress() {
		const address = email.trim();
		if (!LOOKS_LIKE_ADDRESS.test(address)) {
			setEmailError("Enter a full email address, for example hallo@example.be.");
			return;
		}
		setEmailError(null);
		setBusy(true);
		try {
			// Asked again rather than trusting the card, which may be a keystroke behind.
			const current =
				lookup.state === "found" && config ? config : await window.juno.mail.accounts.guess(address, provider);
			setConfig(current);
			// An address the table does not know: ask DNS once, show the answer,
			// and let the next press go on with it.
			if (current.source === "convention" && lookup.state === "idle") {
				setLookup({ state: "looking" });
				try {
					const found = await window.juno.mail.accounts.lookUp(address);
					if (found) {
						setConfig(found);
						setLookup({ state: "found" });
					} else {
						setLookup({ state: "unknown" });
					}
				} catch (cause: unknown) {
					setLookup({ state: "failed", message: messageOf(cause) });
				}
				return;
			}
			setServers(serversFrom(current, address));
			setServersOpen(current.source === "convention");
			setPassword("");
			setSignIn(null);
			setSignInError(null);
			setStage("sign-in");
		} catch (cause: unknown) {
			setEmailError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	/** Back to the address, where the card and the DNS answer are worked out afresh. */
	function backToAddress() {
		setLookup({ state: "idle" });
		setStage("address");
	}

	async function connect(withSignIn: MailSignInResult | null) {
		if (!config) return;
		setStage("ready");
		setResult(null);
		setReadyError(null);
		setBusy(true);
		try {
			// Spaces in an app password are how the provider prints it, not part of it.
			const secret =
				withSignIn !== null
					? { signInId: withSignIn.signInId }
					: { password: config.signIn === "app-password" ? password.replace(/\s+/g, "") : password };
			const outcome = await window.juno.mail.accounts.connect({ ...inputFrom(email, servers), ...secret });
			setResult(outcome);
			if (outcome.account) setPassword("");
		} catch (cause: unknown) {
			setReadyError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function signInWithMicrosoft() {
		setSignInError(null);
		setMicrosoft("waiting");
		try {
			const finished = await window.juno.mail.accounts.signInWithMicrosoft(email.trim());
			setSignIn(finished);
			setMicrosoft("idle");
			await connect(finished);
		} catch (cause: unknown) {
			setMicrosoft("idle");
			setSignInError(messageOf(cause));
		}
	}

	async function toggleMail(on: boolean) {
		setMail(on);
		const account = result?.account;
		if (!account) return;
		try {
			await window.juno.mail.accounts.update(account.id, { syncEnabled: on });
		} catch (cause: unknown) {
			setMail(!on);
			setReadyError(messageOf(cause));
		}
	}

	if (stage === "by-hand") {
		return (
			<ByHandPage
				initialEmail={email}
				initialServers={config ? serversFrom(config, email) : null}
				onBack={() => (email.trim() ? backToAddress() : setStage("choose"))}
				onClose={onClose}
				onSaved={onSaved}
			/>
		);
	}

	if (stage === "choose") {
		return (
			<FormPage
				title="Add mail account"
				description="Where does your mail live? Pick it, or type any address."
				onBack={onClose}
				backLabel="Mail accounts"
			>
				<ProviderPicker onPick={(id) => start(id)} onOther={() => start(null)} onByHand={() => setStage("by-hand")} />
			</FormPage>
		);
	}

	const step = STEP_OF[stage] ?? 0;
	const added = result?.account ?? null;
	const canConnect = config?.signIn === "microsoft" ? signIn !== null : password.length > 0;

	let actions;
	if (stage === "address") {
		actions = (
			<>
				<div className="mr-auto">
					<Button onClick={() => setStage("by-hand")}>Set up by hand</Button>
				</div>
				<Button variant="primary" disabled={busy} onClick={() => void nextFromAddress()}>
					Next
				</Button>
			</>
		);
	} else if (stage === "sign-in") {
		actions = (
			<>
				<Button onClick={backToAddress}>Back</Button>
				{config?.signIn !== "microsoft" || signIn ? (
					<Button variant="primary" disabled={!canConnect || busy} onClick={() => void connect(signIn)}>
						Connect
					</Button>
				) : null}
			</>
		);
	} else if (added) {
		actions = (
			<Button variant="primary" onClick={() => onSaved(added)}>
				Done
			</Button>
		);
	} else {
		actions = (
			<Button disabled={busy} onClick={() => setStage("sign-in")}>
				Back
			</Button>
		);
	}

	return (
		<FormPage
			title="Add mail account"
			onBack={added ? () => onSaved(added) : onClose}
			backLabel="Mail accounts"
			steps={STEPS}
			step={step}
			stepsAhead
			// Once the account exists there is nothing earlier to change.
			onStep={added || busy ? undefined : (index) => (index === 0 ? backToAddress() : setStage("sign-in"))}
			actions={actions}
		>
			{stage === "address" ? (
				<AddressStep
					email={email}
					onEmail={(next) => {
						setEmail(next);
						setEmailError(null);
						setLookup({ state: "idle" });
					}}
					config={config && config.domain === domainOf(email) ? config : null}
					// "Recognised" when the address is at the tile's own domain, "Picked" when only the tile says so.
					picked={provider !== null && !(mailProvider(provider)?.domains.includes(domainOf(email)) ?? false)}
					lookup={lookup}
					error={emailError}
					onSubmit={() => void nextFromAddress()}
				/>
			) : stage === "sign-in" && config ? (
				<SignInStep
					email={email}
					config={config}
					servers={servers}
					onServers={setServers}
					serversOpen={serversOpen}
					password={password}
					onPassword={setPassword}
					onSubmit={() => {
						if (canConnect && !busy) void connect(signIn);
					}}
					microsoft={microsoft}
					onMicrosoft={() => void signInWithMicrosoft()}
					onCancelMicrosoft={() => void window.juno.mail.accounts.cancelSignIn()}
					error={signInError}
				/>
			) : (
				<ReadyStep
					result={result}
					hosts={{ imap: servers.imapHost, smtp: servers.smtpHost }}
					mail={mail}
					onMail={(on) => void toggleMail(on)}
					// Calendar subscriptions add "subscribe to this account's calendar" here
					// through `calendarSlot`. Not built yet, so nothing is passed.
					error={readyError}
				/>
			)}
		</FormPage>
	);
}
