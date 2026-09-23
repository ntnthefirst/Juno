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
	PersonIllustration,
	WelcomeIllustration,
} from "./OnboardingIllustrations";

/**
 * Mirrors ONBOARDING_VERSION in electron/main/services/settings.ts. The
 * renderer has no channel that reads the constant itself, only setOnboarding to
 * write the state it gates, so the two are kept in step by hand. A step added to
 * this flow that an existing install has never seen should bump both.
 *
 * Version 2 split the one long business step into a name and a business step,
 * and stopped asking for an email address and a phone number here: those are
 * lists now, kept under settings, and a first run is the wrong moment to ask
 * for four of each.
 */
const SETUP_VERSION = 2;

type StepId = "welcome" | "you" | "business" | "appearance" | "lock" | "mail" | "done";

const STEPS: { id: StepId; label: string }[] = [
	{ id: "welcome", label: "Welcome" },
	{ id: "you", label: "Your name" },
	{ id: "business", label: "Your business" },
	{ id: "appearance", label: "Appearance" },
	{ id: "lock", label: "Lock" },
	{ id: "mail", label: "Mail" },
	{ id: "done", label: "Ready" },
];

type SetupFlowProps = {
	/**
	 * Called once setup is answered, whether or not anything was skipped:
	 * choosing not to answer is still an answer. The window closes on it.
	 */
	onFinished: () => void;
};

/**
 * The first-run flow, inside its own small window (app/SetupWindow.tsx).
 *
 * Whether the walkthrough follows is not a flag passed back here. It is
 * `walkthroughSeenAt` in the stored onboarding state: the main window starts
 * the tour when setup is finished and that timestamp is still null, which is
 * also how Settings > General replays it. So "Start using Juno" writes the
 * timestamp and "Take the walkthrough" leaves it alone.
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

	async function finish(options: { walkthrough: boolean; openMailSettings?: boolean }) {
		const stamp = new Date().toISOString();
		try {
			await window.juno.settings.setOnboarding({
				completedAt: stamp,
				version: SETUP_VERSION,
				// Only the tour that is being taken leaves this null. Everything
				// else, including skipping setup outright, counts as answered.
				...(options.walkthrough ? {} : { walkthroughSeenAt: stamp }),
			});
		} finally {
			if (options.openMailSettings) {
				// The main process closes this window as it opens that one: two modal
				// children of one parent fight over focus.
				void window.juno.window.openSettings("mail");
			} else {
				onFinished();
			}
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col px-8 pb-6 pt-5">
			<StepRail step={index} onSelect={goTo} />

			{/*
				min-h-0 plus justify-center on the inner column, inside the scrolling
				one, is what lets a short step sit centred in the space below the rail
				while a long one still overflows into the scroll rather than being
				clipped: the browser falls back to top alignment once it no longer fits.
			*/}
			<div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto">
				<div className="flex min-h-0 flex-1 flex-col justify-center">
					<div ref={panelRef} tabIndex={-1} key={step} className="w-full outline-none">
						{step === "welcome" ? (
							// "Skip setup" means skip, not "jump to one more screen with a
							// button on it": it completes on its own, the same way the last
							// step's buttons do.
							<WelcomeStep onStart={() => goTo(1)} onSkip={() => void finish({ walkthrough: false })} />
						) : step === "you" ? (
							<NameStep onContinue={() => goTo(index + 1)} />
						) : step === "business" ? (
							<BusinessStep onContinue={() => goTo(index + 1)} />
						) : step === "appearance" ? (
							<AppearanceStep onContinue={() => goTo(index + 1)} />
						) : step === "lock" ? (
							<LockStep onContinue={() => goTo(index + 1)} />
						) : step === "mail" ? (
							<MailStep
								onContinue={() => goTo(index + 1)}
								onAddAccount={() => void finish({ walkthrough: false, openMailSettings: true })}
							/>
						) : (
							<DoneStep
								onTakeWalkthrough={() => void finish({ walkthrough: true })}
								onStart={() => void finish({ walkthrough: false })}
							/>
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

/**
 * Dots rather than seven labels in a row: the window is 760px wide, and seven
 * words with connectors between them wraps to two lines and reads like a menu.
 * A step already passed is reachable; a step ahead is not, because it has not
 * been filled in yet.
 */
function StepRail({ step, onSelect }: StepRailProps) {
	return (
		<div className="flex flex-none items-center justify-between gap-4">
			<ol className="flex items-center gap-1.5">
				{STEPS.map((entry, index) => {
					const state = index === step ? "current" : index < step ? "done" : "ahead";
					const reachable = state === "done";
					return (
						<li key={entry.id} className="flex">
							<button
								type="button"
								disabled={!reachable}
								aria-label={entry.label}
								aria-current={state === "current" ? "step" : undefined}
								onClick={reachable ? () => onSelect(index) : undefined}
								className="flex h-8 w-5 items-center justify-center rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<span
									aria-hidden
									className={[
										"block rounded-[var(--radius-full)] transition-all duration-[var(--duration-base)] ease-[var(--ease)]",
										state === "current"
											? "h-2 w-5 bg-[var(--accent)]"
											: state === "done"
												? "h-2 w-2 bg-[var(--accent)]"
												: "h-2 w-2 bg-[var(--line-strong)]",
									].join(" ")}
								/>
							</button>
						</li>
					);
				})}
			</ol>

			<p className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Step {step + 1} of {STEPS.length}
			</p>
		</div>
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
			<h1 className="mt-5 text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">
				Welcome to Juno
			</h1>
			<p className="mt-3 max-w-[46ch] text-[var(--ink-muted)]">
				Juno keeps your clients, documents, mail, calendar and reminders on this machine. Nothing
				leaves it unless you send it yourself, and there is no account to sign in to.
			</p>
			<p className="mt-2 max-w-[46ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Five short questions. Every one of them can be answered later instead.
			</p>
			<div className="mt-7 flex flex-col items-center gap-2">
				<Button variant="primary" onClick={onStart}>
					Set up Juno
				</Button>
				<button
					type="button"
					onClick={onSkip}
					className="inline-flex h-10 items-center px-2 text-[length:var(--text-sm)] text-[var(--ink-muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					Skip setup
				</button>
			</div>
		</div>
	);
}

/** Loads the profile once, so a step can edit it and hand it back. */
function useOwnerProfile(): {
	profile: OwnerProfile | null;
	setProfile: (next: OwnerProfile) => void;
	loadError: string | null;
} {
	const [profile, setProfile] = useState<OwnerProfile | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.settings
			.getOwner()
			.then((value) => {
				if (!cancelled) setProfile(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoadError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return { profile, setProfile, loadError };
}

type StepProps = {
	onContinue: () => void;
};

function NameStep({ onContinue }: StepProps) {
	const { profile, setProfile, loadError } = useOwnerProfile();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function save() {
		if (!profile || busy) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.setOwner({
				firstName: profile.firstName,
				lastName: profile.lastName,
			});
			onContinue();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div>
			<Heading illustration={<PersonIllustration />} title="Your name" />
			<p className="mt-3 text-[var(--ink-muted)]">
				This is the name that signs a contract and goes out under an email. Your email addresses
				and phone numbers come later, in settings, where they can be a list.
			</p>

			{profile === null ? (
				<p className="mt-6 text-[var(--ink-muted)]">{loadError ?? "Loading."}</p>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field
						label="First name"
						value={profile.firstName}
						onChange={(value) => setProfile({ ...profile, firstName: value })}
					/>
					<Field
						label="Last name"
						value={profile.lastName}
						onChange={(value) => setProfile({ ...profile, lastName: value })}
					/>
				</div>
			)}

			<StepFooter error={error}>
				<Button variant="primary" disabled={!profile || busy} onClick={() => void save()}>
					Continue
				</Button>
			</StepFooter>
		</div>
	);
}

function BusinessStep({ onContinue }: StepProps) {
	const { profile, setProfile, loadError } = useOwnerProfile();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function save() {
		if (!profile || busy) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.setOwner({
				businessName: profile.businessName,
				vatNumber: profile.vatNumber,
				establishmentNumber: profile.establishmentNumber,
			});
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
				These end up in front of clients, in the contracts and emails Juno generates. Nothing here
				is required, and your address and IBAN wait in settings, under Your business.
			</p>

			{profile === null ? (
				<p className="mt-6 text-[var(--ink-muted)]">{loadError ?? "Loading."}</p>
			) : (
				<div className="mt-6 flex flex-col gap-4">
					<Field
						label="Business name"
						value={profile.businessName}
						onChange={(value) => setProfile({ ...profile, businessName: value })}
					/>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field
							label="VAT number"
							placeholder="BE0123456789"
							value={profile.vatNumber}
							onChange={(value) => setProfile({ ...profile, vatNumber: value })}
						/>
						<Field
							label="Establishment number"
							placeholder="2123456789"
							help="The vestigingsnummer of your registered office, if you have one. Not the same as the VAT number."
							value={profile.establishmentNumber}
							onChange={(value) => setProfile({ ...profile, establishmentNumber: value })}
						/>
					</div>
				</div>
			)}

			<StepFooter error={error}>
				<Button variant="primary" disabled={!profile || busy} onClick={() => void save()}>
					Continue
				</Button>
			</StepFooter>
		</div>
	);
}

function AppearanceStep({ onContinue }: StepProps) {
	const [theme, setTheme] = useTheme();

	return (
		<div>
			{/*
				No title of its own: the section below brings its own heading and its
				own description, and a step that says "Appearance" twice in 80px reads
				as a mistake. The same goes for the lock step under this one.
			*/}
			<Heading illustration={<AppearanceIllustration />} />
			<div className="mt-5">
				<AppearanceSection theme={theme} onChange={setTheme} />
			</div>
			<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Applied straight away, so you see the choice while you make it, and changeable at any time
				from settings.
			</p>
			<StepFooter error={null}>
				<Button variant="primary" onClick={onContinue}>
					Continue
				</Button>
			</StepFooter>
		</div>
	);
}

function LockStep({ onContinue }: StepProps) {
	return (
		<div>
			<Heading illustration={<LockIllustration />} />
			{/*
				The section below carries the sentence .claude/rules/security.md
				section 8 requires, in its own words: the lock screen protects against
				someone walking up to this laptop, and not the database file on disk.
				Saying it twice on one 620px step is what the second copy that used to
				live here did.
			*/}
			<div className="mt-5">
				<LockSection />
			</div>
			<p className="mt-4 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Setting one up is optional, and "not now" is a fine answer.
			</p>
			<StepFooter error={null}>
				<Button variant="primary" onClick={onContinue}>
					Continue
				</Button>
			</StepFooter>
		</div>
	);
}

type MailStepProps = {
	onContinue: () => void;
	onAddAccount: () => void;
};

function MailStep({ onContinue, onAddAccount }: MailStepProps) {
	return (
		<div>
			<Heading illustration={<MailIllustration />} title="Mail" />
			<p className="mt-3 text-[var(--ink-muted)]">
				Juno reads mail over IMAP, from accounts you type in yourself. Passwords are stored by the
				operating system's own keychain, never in the database, and nothing is ever written back to
				the server. This can wait.
			</p>
			<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Adding one now finishes setup and opens settings on mail accounts.
			</p>
			<StepFooter error={null}>
				<Button onClick={onContinue}>Skip for now</Button>
				<Button variant="primary" onClick={onAddAccount}>
					Add a mail account
				</Button>
			</StepFooter>
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
			const named = [owner.firstName, owner.lastName, owner.businessName].some(
				(value) => value.trim().length > 0,
			);
			setSummary([
				named ? "Your name and business are filled in." : "Your name and business are still empty.",
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

			<StepFooter error={null}>
				<Button onClick={onTakeWalkthrough}>Take the walkthrough</Button>
				<Button variant="primary" onClick={onStart}>
					Start using Juno
				</Button>
			</StepFooter>
		</div>
	);
}

type StepFooterProps = {
	error: string | null;
	children: React.ReactNode;
};

/** The buttons of one step, and anything that went wrong on the way out. */
function StepFooter({ error, children }: StepFooterProps) {
	return (
		<>
			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}
			<div className="mt-7 flex flex-wrap justify-end gap-2">{children}</div>
		</>
	);
}

type HeadingProps = {
	illustration: React.ReactNode;
	/** Left out by a step whose content brings a heading of its own. */
	title?: string;
};

function Heading({ illustration, title }: HeadingProps) {
	return (
		<div className="flex flex-col items-center text-center">
			{illustration}
			{title ? (
				<h1 className="mt-4 text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]">
					{title}
				</h1>
			) : null}
		</div>
	);
}
