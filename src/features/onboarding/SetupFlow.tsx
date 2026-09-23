import { useEffect, useRef, useState } from "react";
import type { OwnerProfile } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { useTheme } from "../../lib/theme";
import { AppearanceSection } from "../settings/AppearanceSection";
import { LockSection } from "../settings/LockSection";
import {
	AppearanceIllustration,
	BusinessIllustration,
	DoneIllustration,
	LockIllustration,
	MailIllustration,
	WelcomeIllustration,
} from "./OnboardingIllustrations";

/**
 * Mirrors ONBOARDING_VERSION in electron/main/services/settings.ts. The
 * renderer has no channel that reads the constant itself, only setOnboarding to
 * write the state it gates, so the two are kept in step by hand. A step added to
 * this flow that an existing install has never seen should bump both.
 */
const SETUP_VERSION = 1;

type StepId = "welcome" | "business" | "appearance" | "lock" | "mail" | "done";

const STEPS: { id: StepId; label: string }[] = [
	{ id: "welcome", label: "Welcome" },
	{ id: "business", label: "Business" },
	{ id: "appearance", label: "Appearance" },
	{ id: "lock", label: "Lock" },
	{ id: "mail", label: "Mail" },
	{ id: "done", label: "Done" },
];

type SetupFlowProps = {
	/**
	 * Called once the last step is answered, whether or not anything was
	 * skipped: choosing not to answer is still an answer. `startWalkthrough` is
	 * true when the person asked for the tour next, so the shell can start it as
	 * soon as it mounts.
	 */
	onFinished: (startWalkthrough: boolean) => void;
};

/**
 * The first-run flow. It replaces the shell entirely rather than sitting inside
 * it: there is nothing behind it to go back to until it is answered, which is
 * also why it never draws its own title bar and never treats Escape as a way
 * out (see the reserved strip below and App.tsx, which renders this instead of
 * the shell while setup is unfinished).
 */
export function SetupFlow({ onFinished }: SetupFlowProps) {
	const [index, setIndex] = useState(0);
	const step = STEPS[Math.min(index, STEPS.length - 1)].id;
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		panelRef.current?.focus();
	}, [index]);

	function goTo(next: number) {
		setIndex(Math.max(0, Math.min(STEPS.length - 1, next)));
	}

	async function finish(startWalkthrough: boolean) {
		try {
			await window.juno.settings.setOnboarding({
				completedAt: new Date().toISOString(),
				version: SETUP_VERSION,
			});
		} finally {
			onFinished(startWalkthrough);
		}
	}

	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			{/*
				The shell draws the window's title bar; this flow replaces the shell
				and so draws none. What it still owes the window is the empty strip
				the operating system's own caption buttons sit over: skipping this
				and putting content up there means a click meant for this flow lands
				on a native button instead, and the reverse too, so the window ends up
				with no way to close it from here.
			*/}
			<div className="drag-region flex-none" style={{ height: "var(--titlebar-height)" }} aria-hidden />

			<div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 py-10">
				<StepRail step={index} onSelect={goTo} />

				{/*
					min-h-0 plus justify-center on this flex column, inside the scrolling
					container above, is what lets a short step (welcome) sit centred in
					the space below the rail while a long one (business, eleven fields)
					still overflows into the outer scroll rather than being clipped: the
					browser falls back to top alignment once content no longer fits.
				*/}
				<div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
					<div ref={panelRef} tabIndex={-1} key={step} className="w-full max-w-[560px] outline-none">
						{step === "welcome" ? (
							// "Skip setup" means skip, not "jump to one more screen with a
							// button on it": it completes on its own, the same way the last
							// step's buttons do.
							<WelcomeStep onStart={() => goTo(1)} onSkip={() => void finish(false)} />
						) : step === "business" ? (
							<BusinessStep onContinue={() => goTo(index + 1)} />
						) : step === "appearance" ? (
							<AppearanceStep onContinue={() => goTo(index + 1)} />
						) : step === "lock" ? (
							<LockStep onContinue={() => goTo(index + 1)} />
						) : step === "mail" ? (
							<MailStep onContinue={() => goTo(index + 1)} />
						) : (
							<DoneStep onTakeWalkthrough={() => void finish(true)} onStart={() => void finish(false)} />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

type StepRailProps = {
	step: number;
	onSelect: (index: number) => void;
};

/** A step already passed is reachable; a step ahead is not, because it has not been filled in yet. */
function StepRail({ step, onSelect }: StepRailProps) {
	return (
		<ol className="mb-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
			{STEPS.map((entry, index) => {
				const state = index === step ? "current" : index < step ? "done" : "ahead";
				const reachable = state === "done";
				return (
					<li key={entry.id} className="flex items-center gap-2">
						{index > 0 ? <span aria-hidden className="h-px w-6 bg-[var(--line-strong)]" /> : null}
						<button
							type="button"
							disabled={!reachable}
							aria-current={state === "current" ? "step" : undefined}
							onClick={reachable ? () => onSelect(index) : undefined}
							className={[
								"flex h-[28px] items-center gap-2 rounded-[var(--radius-md)] px-2 text-[length:var(--text-dense)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
								state === "current" ? "font-[var(--weight-medium)] text-[var(--ink)]" : "text-[var(--ink-muted)]",
								reachable ? "hover:bg-[var(--hover)] hover:text-[var(--ink)]" : "",
							].join(" ")}
						>
							<span
								aria-hidden
								className={[
									"tabular flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full text-[length:var(--text-micro)] font-[var(--weight-medium)]",
									state === "ahead"
										? "border border-[var(--line-strong)] text-[var(--ink-faint)]"
										: "bg-[var(--accent)] text-[var(--accent-ink)]",
								].join(" ")}
							>
								{index + 1}
							</span>
							{entry.label}
						</button>
					</li>
				);
			})}
		</ol>
	);
}

type WelcomeStepProps = {
	onStart: () => void;
	onSkip: () => void;
};

function WelcomeStep({ onStart, onSkip }: WelcomeStepProps) {
	return (
		<div className="flex flex-col items-center text-center">
			<WelcomeIllustration />
			<h1 className="mt-6 text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">
				Welcome to Juno
			</h1>
			<p className="mt-3 max-w-[46ch] text-[var(--ink-muted)]">
				Juno keeps your clients, documents, mail, calendar and reminders on this machine. Nothing
				leaves it unless you send it yourself, and there is no account to sign in to.
			</p>
			<div className="mt-8 flex flex-col items-center gap-3">
				<Button variant="primary" onClick={onStart}>
					Set up Juno
				</Button>
				<button
					type="button"
					onClick={onSkip}
					className="inline-flex h-10 items-center px-2 text-[length:var(--text-sm)] text-[var(--ink-muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
				>
					Skip setup
				</button>
			</div>
		</div>
	);
}

const OWNER_FIELDS: { key: keyof OwnerProfile; label: string; type?: "email" | "tel" }[] = [
	{ key: "businessName", label: "Business name" },
	{ key: "contactName", label: "Your name" },
	{ key: "email", label: "Email", type: "email" },
	{ key: "phone", label: "Phone", type: "tel" },
	{ key: "vatNumber", label: "VAT number" },
	{ key: "iban", label: "IBAN" },
	{ key: "addressLine1", label: "Address" },
	{ key: "addressLine2", label: "Address, second line" },
	{ key: "postalCode", label: "Postal code" },
	{ key: "city", label: "City" },
	{ key: "country", label: "Country" },
];

type BusinessStepProps = {
	onContinue: () => void;
};

function BusinessStep({ onContinue }: BusinessStepProps) {
	const [profile, setProfile] = useState<OwnerProfile | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.settings
			.getOwner()
			.then((value) => {
				if (!cancelled) setProfile(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save() {
		if (!profile || busy) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.setOwner(profile);
			onContinue();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div>
			<Heading illustration={<BusinessIllustration />} title="Your business" />
			<p className="mt-3 text-[var(--ink-muted)]">
				These details end up in front of clients: in the contracts and emails Juno generates.
				Nothing here is required. Leave anything blank and it simply shows as missing later, from
				settings.
			</p>

			{profile === null ? (
				<p className="mt-6 text-[var(--ink-muted)]">Loading.</p>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
					{OWNER_FIELDS.map((field) => (
						<Field
							key={field.key}
							label={field.label}
							type={field.type}
							value={profile[field.key]}
							onChange={(value) => setProfile({ ...profile, [field.key]: value })}
						/>
					))}
				</div>
			)}

			{error ? (
				<p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]">
					{error}
				</p>
			) : null}

			<div className="mt-8 flex justify-end">
				<Button variant="primary" disabled={!profile || busy} onClick={() => void save()}>
					Continue
				</Button>
			</div>
		</div>
	);
}

type AppearanceStepProps = {
	onContinue: () => void;
};

function AppearanceStep({ onContinue }: AppearanceStepProps) {
	const [theme, setTheme] = useTheme();

	return (
		<div>
			<Heading illustration={<AppearanceIllustration />} title="Appearance" />
			<p className="mt-3 text-[var(--ink-muted)]">
				Applied straight away, so you see the choice while you make it. This can be changed at any
				time from settings.
			</p>
			<div className="mt-6">
				<AppearanceSection theme={theme} onChange={setTheme} />
			</div>
			<div className="mt-8 flex justify-end">
				<Button variant="primary" onClick={onContinue}>
					Continue
				</Button>
			</div>
		</div>
	);
}

type LockStepProps = {
	onContinue: () => void;
};

function LockStep({ onContinue }: LockStepProps) {
	return (
		<div>
			<Heading illustration={<LockIllustration />} title="Lock" />
			{/*
				Required, plainly, by .claude/rules/security.md section 8: the lock
				screen protects against someone walking up to this laptop while Juno
				is open. It does not protect the database file itself, which is why
				LockSection's own description below says so again in its own words.
			*/}
			<p className="mt-3 text-[var(--ink-muted)]">
				A lock screen protects against someone walking up to this laptop while Juno is open. It
				does not protect the database file itself: anyone who can copy it off this machine can
				still read it. Setting one up is optional, and "not now" is a fine answer.
			</p>
			<div className="mt-6">
				<LockSection />
			</div>
			<div className="mt-8 flex justify-end">
				<Button variant="primary" onClick={onContinue}>
					Continue
				</Button>
			</div>
		</div>
	);
}

type MailStepProps = {
	onContinue: () => void;
};

function MailStep({ onContinue }: MailStepProps) {
	return (
		<div>
			<Heading illustration={<MailIllustration />} title="Mail" />
			<p className="mt-3 text-[var(--ink-muted)]">
				Juno reads mail over IMAP, from accounts you type in yourself. Passwords are stored by the
				operating system's own keychain, never in the database, and nothing is ever written back to
				the server. This can wait.
			</p>
			<div className="mt-8 flex flex-wrap justify-end gap-2">
				<Button onClick={onContinue}>Skip for now</Button>
				<Button variant="primary" onClick={() => void window.juno.window.openSettings()}>
					Add a mail account
				</Button>
			</div>
		</div>
	);
}

type DoneStepProps = {
	onTakeWalkthrough: () => void;
	onStart: () => void;
};

function DoneStep({ onTakeWalkthrough, onStart }: DoneStepProps) {
	const [summary, setSummary] = useState<string[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			const [owner, lock, accounts] = await Promise.all([
				window.juno.settings.getOwner(),
				window.juno.lock.state(),
				window.juno.mail.accounts.list(),
			]);
			if (cancelled) return;
			const filledIn = Object.values(owner).some((value) => value.trim().length > 0);
			setSummary([
				filledIn ? "Your business details are filled in." : "Your business details are still empty.",
				lock.configured ? "A lock screen is set." : "No lock screen is set.",
				accounts.length > 0
					? `${accounts.length} mail account${accounts.length === 1 ? "" : "s"} added.`
					: "No mail account added yet.",
			]);
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div>
			<Heading illustration={<DoneIllustration />} title="Ready" />
			<p className="mt-3 text-[var(--ink-muted)]">
				Here is where things stand. Every one of these can be changed later, from settings.
			</p>

			{summary === null ? (
				<p className="mt-6 text-[var(--ink-muted)]">Loading.</p>
			) : (
				<ul className="mt-6 flex flex-col gap-2">
					{summary.map((line) => (
						<li key={line} className="flex items-baseline gap-2 text-[var(--ink)]">
							<span aria-hidden className="text-[var(--ink-faint)]">
								/
							</span>
							{line}
						</li>
					))}
				</ul>
			)}

			<div className="mt-8 flex flex-wrap justify-end gap-2">
				<Button onClick={onTakeWalkthrough}>Take the walkthrough</Button>
				<Button variant="primary" onClick={onStart}>
					Start using Juno
				</Button>
			</div>
		</div>
	);
}

type HeadingProps = {
	illustration: React.ReactNode;
	title: string;
};

function Heading({ illustration, title }: HeadingProps) {
	return (
		<div className="flex flex-col items-center text-center">
			{illustration}
			<h1 className="mt-4 text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">
				{title}
			</h1>
		</div>
	);
}
