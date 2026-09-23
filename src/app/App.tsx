import { useEffect, useRef, useState } from "react";
import type { LockState } from "@shared/types";
import { LockScreen } from "../components/LockScreen";
import { AgentScreen } from "../features/agent/AgentScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { ClientsScreen } from "../features/clients/ClientsScreen";
import { DocumentsScreen } from "../features/documents/DocumentsScreen";
import { MailScreen } from "../features/mail/MailScreen";
import { SetupFlow } from "../features/onboarding/SetupFlow";
import { Walkthrough } from "../features/onboarding/Walkthrough";
import { RemindersScreen } from "../features/reminders/RemindersScreen";
import { DocumentTemplatesScreen } from "../features/templates/DocumentTemplatesScreen";
import { MailTemplatesScreen } from "../features/templates/MailTemplatesScreen";
import { TodayScreen } from "../features/today/TodayScreen";
import { useTheme } from "../lib/theme";
import { BreadcrumbProvider } from "./breadcrumb";
import { useBreadcrumbTrail } from "./breadcrumb-context";
import { SCREEN_LABELS, type ScreenId } from "./screens";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useSidebarLayout } from "./use-sidebar-layout";

export function App() {
	return (
		<BreadcrumbProvider>
			<Shell />
		</BreadcrumbProvider>
	);
}

/**
 * Gates what the window shows: nothing until both the lock and the onboarding
 * answer are in, then the lock screen if locked (it wins over everything,
 * including an unfinished setup), then setup if it has never been finished,
 * then the shell itself.
 */
function Shell() {
	useTheme();
	const [lock, setLock] = useState<LockState | null>(null);
	const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | null>(null);
	const [walkthroughOpen, setWalkthroughOpen] = useState(false);

	// Settings is a separate, modal window (decision 26): there is no channel
	// back from it, so a replay requested there (features/settings/
	// OnboardingSection.tsx) is picked up here the moment this window gets
	// focus again, which in practice is as soon as that one closes. The ref
	// only arms the check after Settings was actually opened from here, so an
	// ordinary alt-tab back into Juno does not re-run it for no reason.
	const settingsOpenedRef = useRef(false);

	useEffect(() => {
		void window.juno.lock.state().then(setLock);
		// The main process locks on idle, sleep and minimise without being asked,
		// so the interface has to be told rather than poll.
		return window.juno.lock.onChange(setLock);
	}, []);

	useEffect(() => {
		void window.juno.settings.needsOnboarding().then(setOnboardingNeeded);
	}, []);

	useEffect(() => {
		function onFocus() {
			if (!settingsOpenedRef.current) return;
			settingsOpenedRef.current = false;
			void window.juno.settings.needsOnboarding().then((needed) => {
				if (needed) {
					setOnboardingNeeded(true);
					return;
				}
				void window.juno.settings.getOnboarding().then((state) => {
					if (state.walkthroughSeenAt === null) setWalkthroughOpen(true);
				});
			});
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);

	// Until both answers arrive, render nothing rather than a flash of a screen
	// that is about to be replaced by whichever of lock, setup or the shell
	// actually applies.
	if (lock === null || onboardingNeeded === null) return <div className="h-full bg-[var(--paper)]" />;

	if (lock.locked) {
		return (
			<LockScreen
				state={lock}
				onUnlocked={() => void window.juno.lock.state().then(setLock)}
			/>
		);
	}

	if (onboardingNeeded) {
		return (
			<SetupFlow
				onFinished={(startWalkthrough) => {
					setOnboardingNeeded(false);
					if (startWalkthrough) setWalkthroughOpen(true);
				}}
			/>
		);
	}

	return (
		<MainShell
			lock={lock}
			walkthroughOpen={walkthroughOpen}
			onWalkthroughClosed={() => setWalkthroughOpen(false)}
			onSettingsOpened={() => {
				settingsOpenedRef.current = true;
			}}
		/>
	);
}

type MainShellProps = {
	lock: LockState;
	walkthroughOpen: boolean;
	onWalkthroughClosed: () => void;
	onSettingsOpened: () => void;
};

/** The application proper: title bar, sidebar and the current screen. */
function MainShell({ lock, walkthroughOpen, onWalkthroughClosed, onSettingsOpened }: MainShellProps) {
	const [screen, setScreen] = useState<ScreenId>("today");
	const sidebar = useSidebarLayout();
	const trail = useBreadcrumbTrail();

	const navigate = (id: ScreenId) => {
		setScreen(id);
		// On a narrow window the sidebar is covering the thing just chosen.
		if (sidebar.floating) sidebar.close();
	};

	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			<TitleBar
				title={SCREEN_LABELS[screen]}
				trail={trail}
				sidebarCollapsed={sidebar.collapsed}
				onToggleSidebar={sidebar.toggle}
				onOpenReminders={() => setScreen("reminders")}
				lockConfigured={lock.configured}
				onLock={() => void window.juno.lock.lock()}
			/>
			<div className="relative flex min-h-0 flex-1">
				{sidebar.visible ? (
					<Sidebar
						current={screen}
						onNavigate={navigate}
						collapsed={sidebar.collapsed}
						floating={sidebar.floating}
						onOpenSettings={() => {
							onSettingsOpened();
							void window.juno.window.openSettings();
						}}
					/>
				) : null}

				{sidebar.floating ? (
					// Dismisses the drawer, and stops a click landing on whatever is
					// underneath it. Not focusable: Escape already closes it.
					<button
						type="button"
						tabIndex={-1}
						aria-label="Close the sidebar"
						onClick={sidebar.close}
						className="absolute inset-0 z-10 bg-[var(--ink)]/20"
					/>
				) : null}

				<main className="min-w-0 flex-1 overflow-auto">
					{screen === "today" ? (
						<TodayScreen />
					) : screen === "clients" ? (
						<ClientsScreen />
					) : screen === "reminders" ? (
						<RemindersScreen />
					) : screen === "documents" ? (
						<DocumentsScreen />
					) : screen === "mail" ? (
						<MailScreen />
					) : screen === "calendar" ? (
						<CalendarScreen />
					) : screen === "templates" ? (
						<MailTemplatesScreen />
					) : screen === "document-templates" ? (
						<DocumentTemplatesScreen />
					) : screen === "agent" ? (
						<AgentScreen />
					) : (
						<Placeholder title={SCREEN_LABELS[screen]} />
					)}
				</main>
			</div>

			{walkthroughOpen ? <Walkthrough onNavigate={navigate} onClose={onWalkthroughClosed} /> : null}
		</div>
	);
}

function Placeholder({ title }: { title: string }) {
	return (
		<div className="p-8">
			<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">{title}</h1>
			<p className="mt-3 max-w-[60ch] text-[var(--ink-muted)]">
				Not built yet. See PLAN.md for which phase this arrives in.
			</p>
		</div>
	);
}
