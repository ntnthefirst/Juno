import { useCallback, useEffect, useRef, useState } from "react";
import type { LockState } from "@shared/types";
import { installMenuIcons } from "../lib/menu-icons";
import { LockScreen } from "../components/LockScreen";
import { LoadingScreen } from "../components/LoadingScreen";
import { AgentNotices } from "../features/agent/AgentNotices";
import { AgentScreen } from "../features/agent/AgentScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { ClientsScreen } from "../features/clients/ClientsScreen";
import { DocumentsScreen } from "../features/documents/DocumentsScreen";
import { MailScreen } from "../features/mail/MailScreen";
import { NotesScreen } from "../features/notes/NotesScreen";
import { Walkthrough } from "../features/onboarding/Walkthrough";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import { RemindersScreen } from "../features/reminders/RemindersScreen";
import { DocumentTemplatesScreen } from "../features/templates/DocumentTemplatesScreen";
import { MailTemplatesScreen } from "../features/templates/MailTemplatesScreen";
import { OverviewScreen } from "../features/overview/OverviewScreen";
import { onOpenClientRequest } from "../lib/open-client";
import { offerDraft } from "../lib/open-draft";
import { currentRequest, onOpenRequest, requestOpen } from "../lib/open-entity";
import { announceRecordsChanged } from "../lib/new-record";
import { currentScreenAction, onScreenActionRequest, requestScreenAction, type ScreenAction } from "../lib/screen-actions";
import { useThemeSync } from "../lib/theme";
import { CommandPalette } from "./CommandPalette";
import { DocumentDropLayer } from "./DocumentDropLayer";
import { BreadcrumbProvider } from "./breadcrumb";
import { useBreadcrumbTrail } from "./breadcrumb-context";
import { NEW_ON, SCREEN_LABELS, SIDEBAR_ENTRY, type ScreenId } from "./screens";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { TitleBarSlotContext } from "./titlebar-slot-context";
import { useShortcuts } from "./use-shortcuts";

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
	useThemeSync();
	const [lock, setLock] = useState<LockState | null>(null);
	const [walkthroughOpen, setWalkthroughOpen] = useState(false);

	// Setup is offered once per unanswered state. Without this, closing the
	// setup window without answering it would reopen it on the focus that
	// closing it causes, which is a window with no way out.
	const setupOfferedRef = useRef(false);

	// The right-click menus are the platform's own and take bitmaps for their icons.
	useEffect(() => installMenuIcons(), []);

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
		const stop = window.juno.window.onChildClosed((info) => {
			void check();
			// A new-record window that saved something: the screen behind it re-reads.
			if (info.created) announceRecordsChanged();
		});
		return () => {
			cancelled = true;
			stop();
		};
	}, []);

	// Until the lock answer arrives, render the calm branded loading screen.
	if (lock === null) return <LoadingScreen />;

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
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	// The element in the title bar a screen may draw into, held in state so a
	// screen that mounts before the bar has painted still finds it.
	const [slot, setSlot] = useState<HTMLDivElement | null>(null);
	const [rightSlot, setRightSlot] = useState<HTMLDivElement | null>(null);
	const [overflowSlot, setOverflowSlot] = useState<HTMLDivElement | null>(null);
	// How many mounted slots stand in for New (TitleBarSlot `replacesNew`).
	const [newHidden, setNewHidden] = useState(0);
	const hideNew = useCallback(() => {
		setNewHidden((count) => count + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			setNewHidden((count) => count - 1);
		};
	}, []);
	const [recentOpen, setRecentOpen] = useState(false);
	const [agentPending, setAgentPending] = useState(0);

	// The moment the application itself is on screen, for the smoke run's
	// start-up timings. A mark costs nothing and is never read otherwise.
	useEffect(() => {
		performance.mark("juno:shell");
	}, []);

	useEffect(() => {
		const refresh = () => {
			void window.juno.agent.actions
				.pendingCount()
				.then(setAgentPending)
				.catch(() => setAgentPending(0));
		};
		refresh();
		return window.juno.agent.actions.onChange(refresh);
	}, []);

	const navigate = (id: ScreenId) => {
		if (id === screen) setVisit((count) => count + 1);
		setScreen(id);
	};

	// A record is open over its list when the trail has more than one step. Back
	// is the step before the last, which is the one that knows how to return.
	const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;
	const back = parent?.onSelect ? { label: parent.label, onSelect: parent.onSelect } : null;

	// "New" starts the record that belongs to the screen on show, by asking the
	// screen that owns it to open its form. The screen is brought up fresh first,
	// and opens the form once it has mounted.
	const startNew = (target: ScreenId, action: ScreenAction = "new") => requestScreenAction(target, action);
	const newHere = () => {
		const target = NEW_ON[screen];
		if (target) startNew(target.screen);
	};

	useShortcuts({
		palette: () => setPaletteOpen((open) => !open),
		recent: () => setRecentOpen((open) => !open),
		reminders: () => navigate("reminders"),
		goTo: navigate,
		newItem: newHere,
		newPage: () => startNew("documents", "new-page"),
		settings: () => void window.juno.window.openSettings(),
		back: () => back?.onSelect(),
		lock: lock.configured ? () => void window.juno.lock.lock() : null,
		help: () => setHelpOpen(true),
	});

	// Something asked a screen to start a new record. The screen is read by its own
	// mount, so this only has to bring it up.
	useEffect(
		() =>
			onScreenActionRequest(() => {
				const request = currentScreenAction();
				if (!request) return;
				setVisit((count) => count + 1);
				setScreen(request.screen);
			}),
		[],
	);

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
					target.kind === "project"
						? "projects"
						: target.kind === "document"
							? "documents"
							: target.kind === "note"
								? "notes"
							: target.kind === "thread"
								? "mail"
								: target.kind === "mail-template"
									? "mail-templates"
									: target.screen;
				setVisit((count) => count + 1);
				setScreen(next);
			}),
		[],
	);

	// A toast or the tray asked for something. The main process only holds a
	// request while Juno is unlocked, so what arrives here was asked for by a
	// person at an unlocked machine. Reading it also covers a window that was
	// opened for the purpose and had not mounted when the request was made.
	useEffect(() => {
		let cancelled = false;
		const take = () => {
			void window.juno.window
				.takeShellRequest()
				.then((request) => {
					if (cancelled || !request) return;
					if (request.kind === "agent") requestOpen({ kind: "screen", screen: "agent" });
					else requestScreenAction("notes", "new");
				})
				.catch(() => undefined);
		};
		take();
		const stop = window.juno.window.onShellRequest(take);
		return () => {
			cancelled = true;
			stop();
		};
	}, []);

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
		<TitleBarSlotContext.Provider value={{ left: slot, right: rightSlot, overflow: overflowSlot, hideNew }}>
			<div className="flex h-full flex-col bg-[var(--paper)]">
				<TitleBar
					back={back}
					title={trail[trail.length - 1]?.label ?? (screen === "calendar" ? "" : SCREEN_LABELS[screen])}
					screen={screen}
					onOpenPalette={() => setPaletteOpen(true)}
					recentOpen={recentOpen}
					onRecentOpenChange={setRecentOpen}
					remindersActive={screen === "reminders"}
					onOpenReminders={() => navigate("reminders")}
					onNew={startNew}
					agentActive={screen === "agent"}
					agentPending={agentPending}
					onOpenAgent={() => navigate("agent")}
					slotRef={setSlot}
					rightSlotRef={setRightSlot}
					overflowSlotRef={setOverflowSlot}
					newHidden={newHidden > 0}
				/>
				<div className="relative flex min-h-0 flex-1">
					<Sidebar
						current={SIDEBAR_ENTRY[screen]}
						onNavigate={navigate}
						onOpenSettings={() => void window.juno.window.openSettings()}
					/>

					<main key={`${screen}:${visit}`} className="animate-screen mr-2 mb-2 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
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
						) : screen === "notes" ? (
							<NotesScreen />
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

				{paletteOpen ? (
					<CommandPalette
						onClose={() => setPaletteOpen(false)}
						onNavigate={navigate}
						onNew={startNew}
						onSettings={() => void window.juno.window.openSettings()}
						onLock={lock.configured ? () => void window.juno.lock.lock() : null}
						onHelp={() => setHelpOpen(true)}
					/>
				) : null}
				{helpOpen ? <ShortcutsDialog onClose={() => setHelpOpen(false)} /> : null}

				{walkthroughOpen ? <Walkthrough onNavigate={navigate} onClose={onWalkthroughClosed} /> : null}
			</div>
		</TitleBarSlotContext.Provider>
	);
}

function Placeholder({ title }: { title: string }) {
	return (
		<div className="p-8">
			<h1 className="text-h1">{title}</h1>
			<p className="mt-3 max-w-[60ch] text-[var(--ink-muted)]">
				Not built yet.
			</p>
		</div>
	);
}
