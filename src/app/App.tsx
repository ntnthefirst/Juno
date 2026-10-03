import { useEffect, useRef, useState } from "react";
import type { LockState } from "@shared/types";
import { LockScreen } from "../components/LockScreen";
import { AgentNotices } from "../features/agent/AgentNotices";
import { AgentScreen } from "../features/agent/AgentScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { ClientsScreen } from "../features/clients/ClientsScreen";
import { DocumentsScreen } from "../features/documents/DocumentsScreen";
import { MailScreen } from "../features/mail/MailScreen";
import { Walkthrough } from "../features/onboarding/Walkthrough";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import { RemindersScreen } from "../features/reminders/RemindersScreen";
import { DocumentTemplatesScreen } from "../features/templates/DocumentTemplatesScreen";
import { MailTemplatesScreen } from "../features/templates/MailTemplatesScreen";
import { OverviewScreen } from "../features/overview/OverviewScreen";
import { onOpenClientRequest } from "../lib/open-client";
import { offerDraft } from "../lib/open-draft";
import { currentRequest, onOpenRequest } from "../lib/open-entity";
import { useTheme } from "../lib/theme";
import { DocumentDropLayer } from "./DocumentDropLayer";
import { BreadcrumbProvider } from "./breadcrumb";
import { useBreadcrumbTrail } from "./breadcrumb-context";
import { SCREEN_LABELS, SIDEBAR_ENTRY, type ScreenId } from "./screens";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

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
	const [screen, setScreen] = useState<ScreenId>("overview");
	// Bumped when the entry for the screen already open is chosen again, which
	// remounts it and so returns it to its overview.
	const [visit, setVisit] = useState(0);
	const trail = useBreadcrumbTrail();

	const navigate = (id: ScreenId) => {
		if (id === screen) setVisit((count) => count + 1);
		setScreen(id);
	};

	// Another screen asked for a client to be shown. The request is read by the
	// clients screen when it mounts, so this only has to bring that screen up.
	useEffect(
		() =>
			onOpenClientRequest(() => {
				// Remounts the clients screen when it is already open, so it re-reads the request.
				setVisit((count) => count + 1);
				setScreen("clients");
			}),
		[],
	);

	// A link in the Agent tab. The screen it names is brought up fresh, and reads
	// the request when it mounts.
	useEffect(
		() =>
			onOpenRequest(() => {
				const target = currentRequest();
				if (!target) return;
				const next: ScreenId =
					target.kind === "project" ? "projects" : target.kind === "document" ? "documents" : target.kind === "thread" ? "mail" : target.screen;
				setVisit((count) => count + 1);
				setScreen(next);
			}),
		[],
	);

	// An agent wrote a draft. It opens in the editor on the mail screen, the way
	// one a person started would, and it is the person who sends it.
	useEffect(
		() =>
			window.juno.mail.outbox.onAgentDraft((draft) => {
				offerDraft(draft);
				setScreen("mail");
			}),
		[],
	);

	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			<TitleBar
				title={SCREEN_LABELS[screen]}
				trail={trail}
				lockConfigured={lock.configured}
				onLock={() => void window.juno.lock.lock()}
			/>
			<div className="relative flex min-h-0 flex-1">
				<Sidebar
					current={SIDEBAR_ENTRY[screen]}
					onNavigate={navigate}
					onOpenSettings={() => void window.juno.window.openSettings()}
				/>

				<main key={`${screen}:${visit}`} className="min-w-0 flex-1 overflow-hidden">
					{screen === "overview" ? (
						<OverviewScreen />
					) : screen === "clients" ? (
						<ClientsScreen />
					) : screen === "projects" ? (
						<ProjectsScreen />
					) : screen === "reminders" ? (
						<RemindersScreen />
					) : screen === "documents" ? (
						<DocumentsScreen />
					) : screen === "mail" ? (
						<MailScreen />
					) : screen === "calendar" ? (
						<CalendarScreen />
					) : screen === "mail-templates" ? (
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

			<DocumentDropLayer />
			<AgentNotices />

			{walkthroughOpen ? <Walkthrough onNavigate={navigate} onClose={onWalkthroughClosed} /> : null}
		</div>
	);
}

function Placeholder({ title }: { title: string }) {
	return (
		<div className="p-8">
			<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">{title}</h1>
			<p className="mt-3 max-w-[60ch] text-[var(--ink-muted)]">
				Not built yet.
			</p>
		</div>
	);
}
