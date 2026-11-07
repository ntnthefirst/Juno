import { useEffect, useRef, useState } from "react";
import type { LockSettings, LockState, OwnerProfile } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { messageOf } from "../../lib/errors";
import { isMac } from "../../lib/platform";
import { useTheme } from "../../lib/theme";
import { AppearanceSection } from "../settings/AppearanceSection";
import { LockDialog, type LockMode } from "../settings/LockSection";
import { SoloSectionContext } from "../settings/section-layout";
import welcomeHero from "../../assets/welcome-bureau.jpg";

/**
 * Mirrors ONBOARDING_VERSION in electron/main/services/settings.ts. The
 * renderer has no channel that reads the constant itself, only setOnboarding to
 * write the state it gates, so the two are kept in step by hand. A step added to
 * this flow that an existing install has never seen should bump both.
 *
 * Version 2 split the one long business step into a name and a business step.
 * The about-you step asks for one email address and one phone number again, as
 * the design draws it; they are the first entry of the two lists kept in settings.
 */
const SETUP_VERSION = 2;

type StepId = "welcome" | "you" | "business" | "appearance" | "lock" | "mail" | "done";

const STEPS: { id: StepId; label: string }[] = [
	{ id: "welcome", label: "Welcome" },
	{ id: "you", label: "About you" },
	{ id: "business", label: "Your business" },
	{ id: "appearance", label: "Appearance" },
	{ id: "lock", label: "Lock" },
	{ id: "mail", label: "Mail" },
	{ id: "done", label: "Ready" },
];

const OS_NAME = isMac ? "macOS" : "Windows";

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
 * also how Settings > General replays it. "Open Juno" leaves it null, so the
 * tour follows, and the tour has its own way to close.
 *
 * Every step but the first and the last has Back. Each step saves on Continue,
 * so going back reads what was typed again from the stored profile.
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

	const next = () => goTo(index + 1);
	const back = () => goTo(index - 1);

	return (
		<div className="flex h-full min-h-0 flex-col px-12 pb-6 pt-[62px]">
			<StepRail step={index} onSelect={goTo} />

			<div
				ref={panelRef}
				tabIndex={-1}
				key={step}
				className="mt-[52px] flex min-h-0 flex-1 flex-col outline-none"
			>
				{step === "welcome" ? (
					<WelcomeStep onStart={next} />
				) : step === "you" ? (
					<AboutYouStep onBack={back} onContinue={next} />
				) : step === "business" ? (
					<BusinessStep onBack={back} onContinue={next} />
				) : step === "appearance" ? (
					<AppearanceStep onBack={back} onContinue={next} />
				) : step === "lock" ? (
					<LockStep onBack={back} onContinue={next} />
				) : step === "mail" ? (
					<MailStep
						onBack={back}
						onContinue={next}
						onAddAccount={() => void finish({ walkthrough: false, openMailSettings: true })}
					/>
				) : (
					<DoneStep onOpen={() => void finish({ walkthrough: true })} />
				)}
			</div>
		</div>
	);
}

type StepRailProps = {
	step: number;
	onSelect: (index: number) => void;
};

/**
 * Dots rather than seven labels in a row: the window is 800px wide, and seven
 * words with connectors between them wraps to two lines and reads like a menu.
 * A step already passed is reachable; a step ahead is not, because it has not
 * been filled in yet.
 */
function StepRail({ step, onSelect }: StepRailProps) {
	return (
		<div className="flex flex-none items-center justify-between gap-4">
			<ol className="flex items-center">
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
								className="flex h-6 w-5 items-center justify-center rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>
								<span
									aria-hidden
									className={[
										"block h-1.5 rounded-[var(--radius-full)] transition-all duration-[var(--duration-base)] ease-[var(--ease)]",
										state === "current" ? "w-[30px] bg-[var(--accent)]" : "w-1.5",
										state === "done" ? "bg-[var(--accent)]" : "",
										state === "ahead" ? "bg-[var(--line-strong)]" : "",
									].join(" ")}
								/>
							</button>
						</li>
					);
				})}
			</ol>

			<p className="tabular text-base text-[var(--ink-muted)]">
				Step {step + 1} of {STEPS.length}
			</p>
		</div>
	);
}

type WelcomeStepProps = {
	onStart: () => void;
};

/**
 * One way forward and no way past. Setup used to offer "Skip setup" here,
 * which meant an install could reach the application with no name and no
 * business on it, and then print both into a contract as a missing value.
 * Appearance, the lock and mail are still each skippable; the two questions a
 * generated document cannot do without are not.
 */
function WelcomeStep({ onStart }: WelcomeStepProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto text-center">
			<img
				src={welcomeHero}
				alt="A writing desk"
				className="h-[170px] w-full max-w-[540px] flex-none rounded-[var(--radius-xl)] object-cover"
			/>
			<h1 className="mt-5 text-h1">Welcome to Juno</h1>
			<p className="mt-3 max-w-[560px] text-lg text-[var(--ink-muted)]">
				Your local-first writing desk and back office. Clients, documents, mail, calendar and
				reminders on your machine, with no cloud subscription.
			</p>
			<p className="mt-3 max-w-[460px] text-base text-[var(--ink-muted)]">
				Five short questions set your business name and details for contracts. Appearance, the lock
				and mail can all wait.
			</p>
			<div className="mt-5">
				<Button variant="primary" onClick={onStart}>
					Set up Juno
				</Button>
			</div>
			<p className="mt-4 text-sm text-[var(--ink-faint)]">
				Closing this window closes Juno, and setup opens again next time.
			</p>
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
	onBack: () => void;
	onContinue: () => void;
};

type StepHeadProps = {
	title: string;
	children: React.ReactNode;
};

/** The title and the one sentence under it that every question step starts with. */
function StepHead({ title, children }: StepHeadProps) {
	return (
		<>
			<h1 className="text-h2">{title}</h1>
			<p className="mt-2 max-w-[56ch] text-lg text-[var(--ink-muted)]">{children}</p>
		</>
	);
}

/** The fields of a step, kept to the width the design draws them at. */
function StepFields({ children }: { children: React.ReactNode }) {
	return <div className="mt-4 flex max-w-[420px] flex-col gap-4">{children}</div>;
}

function AboutYouStep({ onBack, onContinue }: StepProps) {
	const { profile, setProfile, loadError } = useOwnerProfile();
	const [email, setEmail] = useState<string | null>(null);
	const [phone, setPhone] = useState<string | null>(null);
	const [attempted, setAttempted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Both halves of the name, because this is what signs a document. Shown only
	// once Continue has been pressed: a form that complains before it is answered
	// reads as a form that has already decided you are wrong.
	const firstMissing = attempted && (profile?.firstName ?? "").trim().length === 0;
	const lastMissing = attempted && (profile?.lastName ?? "").trim().length === 0;

	const primaryEmail = profile?.emails.find((entry) => entry.isPrimary) ?? profile?.emails[0];
	const primaryPhone = profile?.phones.find((entry) => entry.isPrimary) ?? profile?.phones[0];
	const emailValue = email ?? primaryEmail?.email ?? "";
	const phoneValue = phone ?? primaryPhone?.phone ?? "";

	async function save() {
		if (!profile || busy) return;
		setAttempted(true);
		if (profile.firstName.trim().length === 0 || profile.lastName.trim().length === 0) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.setOwner({
				firstName: profile.firstName,
				lastName: profile.lastName,
			});
			// The first entry of each list, which settings shows under Emails and
			// phones. Left empty it adds nothing, and an entry that exists is edited
			// rather than doubled when someone comes back with Back.
			const nextEmail = emailValue.trim();
			if (nextEmail && nextEmail !== primaryEmail?.email) {
				if (primaryEmail) {
					await window.juno.settings.updateOwnerEmail(primaryEmail.id, { email: nextEmail });
				} else {
					await window.juno.settings.addOwnerEmail({ email: nextEmail, isPrimary: true });
				}
			}
			const nextPhone = phoneValue.trim();
			if (nextPhone && nextPhone !== primaryPhone?.phone) {
				if (primaryPhone) {
					await window.juno.settings.updateOwnerPhone(primaryPhone.id, { phone: nextPhone });
				} else {
					await window.juno.settings.addOwnerPhone({ phone: nextPhone, isPrimary: true });
				}
			}
			onContinue();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<StepHead title="About you">
					Your name goes on every document and mail Juno writes for you.
				</StepHead>

				{profile === null ? (
					<p className="mt-4 text-[var(--ink-muted)]">{loadError ?? "Loading."}</p>
				) : (
					<StepFields>
						<div className="grid grid-cols-2 gap-4">
							<Field
								label="First name"
								required
								value={profile.firstName}
								error={firstMissing ? "Enter your first name." : null}
								onChange={(value) => setProfile({ ...profile, firstName: value })}
							/>
							<Field
								label="Last name"
								required
								value={profile.lastName}
								error={lastMissing ? "Enter your last name." : null}
								onChange={(value) => setProfile({ ...profile, lastName: value })}
							/>
						</div>
						<Field label="Email" type="email" value={emailValue} onChange={setEmail} />
						<Field
							label="Phone"
							type="tel"
							placeholder="+32 470 12 34 56"
							value={phoneValue}
							onChange={setPhone}
						/>
					</StepFields>
				)}
			</div>

			<StepFooter error={error}>
				<Button onClick={onBack}>Back</Button>
				<Button variant="primary" disabled={!profile || busy} onClick={() => void save()}>
					Continue
				</Button>
			</StepFooter>
		</>
	);
}

function BusinessStep({ onBack, onContinue }: StepProps) {
	const { profile, setProfile, loadError } = useOwnerProfile();
	const [attempted, setAttempted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// The name is required and the rest is not: a business without a VAT number
	// is ordinary, a contract without a party to it is not.
	const nameMissing = attempted && (profile?.businessName ?? "").trim().length === 0;

	async function save() {
		if (!profile || busy) return;
		setAttempted(true);
		if (profile.businessName.trim().length === 0) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.setOwner({
				businessName: profile.businessName,
				addressLine1: profile.addressLine1,
				postalCode: profile.postalCode,
				city: profile.city,
				vatNumber: profile.vatNumber,
			});
			onContinue();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<StepHead title="Your business">
					These details are printed on contracts and quotes. You can change them later in Settings.
				</StepHead>

				{profile === null ? (
					<p className="mt-4 text-[var(--ink-muted)]">{loadError ?? "Loading."}</p>
				) : (
					<StepFields>
						<Field
							label="Business name"
							required
							value={profile.businessName}
							error={nameMissing ? "Enter the name clients see. Your own name is a fine answer." : null}
							onChange={(value) => setProfile({ ...profile, businessName: value })}
						/>
						<Field
							label="Address"
							value={profile.addressLine1}
							onChange={(value) => setProfile({ ...profile, addressLine1: value })}
						/>
						<div className="grid grid-cols-[120px_1fr] gap-4">
							<Field
								label="Postal code"
								value={profile.postalCode}
								onChange={(value) => setProfile({ ...profile, postalCode: value })}
							/>
							<Field
								label="City"
								value={profile.city}
								onChange={(value) => setProfile({ ...profile, city: value })}
							/>
						</div>
						<Field
							label="VAT number"
							placeholder="BE0123456789"
							value={profile.vatNumber}
							onChange={(value) => setProfile({ ...profile, vatNumber: value })}
						/>
					</StepFields>
				)}
			</div>

			<StepFooter error={error}>
				<Button onClick={onBack}>Back</Button>
				<Button variant="primary" disabled={!profile || busy} onClick={() => void save()}>
					Continue
				</Button>
			</StepFooter>
		</>
	);
}

function AppearanceStep({ onBack, onContinue }: StepProps) {
	const [theme, setTheme] = useTheme();

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<h1 className="text-h2">Appearance</h1>
				{/*
					The section brings the description and the three cards. Solo, so it
					leaves its heading out: the title above is the step's. The choice is
					applied straight away, so the window shows it while it is being made.
				*/}
				<div className="mt-2">
					<SoloSectionContext.Provider value>
						<AppearanceSection
							theme={theme}
							onChange={setTheme}
							description="System follows your operating system. You can switch at any time."
						/>
					</SoloSectionContext.Provider>
				</div>
			</div>
			<StepFooter error={null}>
				<Button onClick={onBack}>Back</Button>
				<Button variant="primary" onClick={onContinue}>
					Continue
				</Button>
			</StepFooter>
		</>
	);
}

function LockStep({ onBack, onContinue }: StepProps) {
	const [state, setState] = useState<LockState | null>(null);
	const [settings, setSettings] = useState<LockSettings | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [mode, setMode] = useState<LockMode | null>(null);
	// What a new lock is, chosen before the dialog asks for the value itself.
	const [wantPin, setWantPin] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([window.juno.lock.state(), window.juno.lock.getSettings()])
			.then(([nextState, nextSettings]) => {
				if (cancelled) return;
				setState(nextState);
				setSettings(nextSettings);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function refresh() {
		try {
			const [nextState, nextSettings] = await Promise.all([
				window.juno.lock.state(),
				window.juno.lock.getSettings(),
			]);
			setState(nextState);
			setSettings(nextSettings);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const configured = state?.configured ?? false;
	const idle =
		settings && settings.idleMinutes > 0
			? `After ${settings.idleMinutes} minutes idle`
			: "When you leave it idle";

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{/*
					The sentence .claude/rules/security.md section 8 requires: the lock
					screen protects against someone at the keyboard, not the file on disk.
				*/}
				<StepHead title="Lock">
					The lock screen stops someone at your keyboard. It does not protect the file on disk.
				</StepHead>

				<div className="mt-4 flex max-w-[560px] flex-col gap-1">
					<Toggle
						label="Lock Juno when you leave"
						description={`${idle} and when ${OS_NAME} locks. You type the passphrase or PIN next.`}
						checked={configured}
						disabled={state === null}
						onChange={(next) => setMode(next ? "setup" : "disable")}
					/>
					<Toggle
						label="Ask for a PIN"
						description="A PIN is convenience only. It does not encrypt anything."
						checked={configured ? state?.method === "pin" : wantPin}
						disabled={configured}
						onChange={setWantPin}
					/>
				</div>
				{error ? (
					<p
						role="alert"
						className="mt-4 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]"
					>
						{error}
					</p>
				) : null}
			</div>

			<StepFooter error={null}>
				<Button onClick={onBack}>Back</Button>
				<Button variant="primary" onClick={onContinue}>
					Continue
				</Button>
			</StepFooter>

			{mode ? (
				<LockDialog
					mode={mode}
					method={state?.method ?? "none"}
					initialKind={wantPin ? "pin" : "passphrase"}
					onClose={() => setMode(null)}
					onDone={() => {
						setMode(null);
						void refresh();
					}}
				/>
			) : null}
		</>
	);
}

type MailStepProps = {
	onBack: () => void;
	onContinue: () => void;
	onAddAccount: () => void;
};

function MailStep({ onBack, onContinue, onAddAccount }: MailStepProps) {
	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<StepHead title="Mail">
					Add an account now, or later in Settings. Passwords are stored by {OS_NAME} and never shown
					again.
				</StepHead>
				<p className="mt-3 max-w-[56ch] text-base text-[var(--ink-muted)]">
					Juno reads mail over IMAP from accounts you type in yourself, and writes nothing back to the
					server. Adding one now finishes setup and opens the account form in Settings.
				</p>
			</div>
			<StepFooter error={null}>
				<Button onClick={onBack}>Back</Button>
				<Button onClick={onContinue}>Skip for now</Button>
				<Button variant="primary" onClick={onAddAccount}>
					Add account
				</Button>
			</StepFooter>
		</>
	);
}

type DoneStepProps = {
	onOpen: () => void;
};

function DoneStep({ onOpen }: DoneStepProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-16 text-center">
			<span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--ok-soft)] text-[var(--ok)]">
				<Icon name="check" size={24} />
			</span>
			<h1 className="mt-5 text-h1">Juno is ready</h1>
			<p className="mt-3 max-w-[52ch] text-lg text-[var(--ink-muted)]">
				Everything is on this machine. A short walkthrough shows each screen.
			</p>
			<div className="mt-6">
				<Button variant="primary" onClick={onOpen}>
					Open Juno
				</Button>
			</div>
		</div>
	);
}

type StepFooterProps = {
	error: string | null;
	children: React.ReactNode;
};

/** The buttons of one step, pinned to the bottom, and anything that went wrong on the way out. */
function StepFooter({ error, children }: StepFooterProps) {
	return (
		<div className="flex-none">
			{error ? (
				<p
					role="alert"
					data-selectable
					className="mb-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2 pt-4">{children}</div>
		</div>
	);
}
