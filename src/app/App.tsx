import { useEffect, useRef, useState } from "react";
import type { LockState } from "@shared/types";
import { LockScreen } from "../components/LockScreen";
import { AgentScreen } from "../features/agent/AgentScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { ClientsScreen } from "../features/clients/ClientsScreen";
import { DocumentsScreen } from "../features/documents/DocumentsScreen";
import { MailScreen } from "../features/mail/MailScreen";
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
 * Gates what the window shows: nothing until the lock answer is in, then the
 * lock screen if locked, then the shell itself.
 *
 * Setup is not one of those branches any more. It is its own small modal
 * window in front of this one (decision 34), asked for here and drawn by the
 * main process, so this window paints the application it is about to
 * configure rather than replacing it.
 */
function Shell() {
	useTheme();
	const [lock, setLock] = useState<LockState | null>(null);
	const [walkthroughOpen, setWalkthroughOpen] = useState(false);

	// Setup is offered once per unanswered state. Without this, closing the
	// setup window without answering it would reopen it on the focus that
	// closing it causes, which is a window with no way out.
	const setupOfferedRef = useRef(false);

	useEffect(() => {
		void window.juno.lock.state().then(setLock);
		// The main process locks on idle, sleep and minimise without being asked,
		// so the interface has to be told rather than poll.
		return window.juno.lock.onChange(setLock);
	}, []);

	// Both the setup window and the settings window are separate and modal
	// (decisions 26 and 34), so there is no channel back from either. The main
	// process says when one of them closed, which is when setup finishing, and
	// a replay asked for in Settings > General, become true here.
	useEffect(() => {
		let cancelled = false;

		async function check() {
			const needed = await window.juno.settings.needsOnboarding();
			if (cancelled) return;
			if (needed) {
				if (!setupOfferedRef.current) {
					setupOfferedRef.current = true;
					void window.juno.window.openSetup();
				}
				return;
			}
			// Answered, so a later reset is a new state worth offering again.
			setupOfferedRef.current = false;
			const state = await window.juno.settings.getOnboarding();
			if (!cancelled && state.walkthroughSeenAt === null) setWalkthroughOpen(true);
		}

		void check();
		const stop = window.juno.window.onChildClosed(() => void check());
		return () => {
			cancelled = true;
			stop();
		};
	}, []);

	// Until the lock answer arrives, render nothing rather than a flash of a
	// screen that is about to be replaced.
	if (lock === null) return <div className="h-full bg-[var(--paper)]" />;

	if (lock.locked) {
		return (
			<LockScreen
				state={lock}
				onUnlocked={() => void window.juno.lock.state().then(setLock)}
			/>
		);
	}

	return (
		<MainShell
			lock={lock}
			walkthroughOpen={walkthroughOpen}
			onWalkthroughClosed={() => setWalkthroughOpen(false)}
		/>
	);
}

type MainShellProps = {
	lock: LockState;
	walkthroughOpen: boolean;
	onWalkthroughClosed: () => void;
};

/** The application proper: title bar, sidebar and the current screen. */
function MainShell({ lock, walkthroughOpen, onWalkthroughClosed }: MainShellProps) {
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
						onOpenSettings={() => void window.juno.window.openSettings()}
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

				<main className="min-w-0 flex-1 overflow-hidden">
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
