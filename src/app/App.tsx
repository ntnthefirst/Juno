import { useEffect, useState } from "react";
import type { LockState } from "@shared/types";
import { LockScreen } from "../components/LockScreen";
import { AgentScreen } from "../features/agent/AgentScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { ClientsScreen } from "../features/clients/ClientsScreen";
import { DocumentsScreen } from "../features/documents/DocumentsScreen";
import { MailScreen } from "../features/mail/MailScreen";
import { RemindersScreen } from "../features/reminders/RemindersScreen";
import { TemplatesScreen } from "../features/templates/TemplatesScreen";
import { TodayScreen } from "../features/today/TodayScreen";
import { useTheme } from "../lib/theme";
import { SCREEN_LABELS, type ScreenId } from "./screens";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useSidebarLayout } from "./use-sidebar-layout";

export function App() {
	useTheme();
	const [screen, setScreen] = useState<ScreenId>("today");
	const [lock, setLock] = useState<LockState | null>(null);
	const [pendingActions, setPendingActions] = useState(0);
	const sidebar = useSidebarLayout();

	useEffect(() => {
		void window.juno.lock.state().then(setLock);
		// The main process locks on idle, sleep and minimise without being asked,
		// so the interface has to be told rather than poll.
		return window.juno.lock.onChange(setLock);
	}, []);

	// A request from an agent can arrive at any moment, on any screen. The
	// badge is how it gets noticed, so it is pushed rather than polled.
	const unlocked = lock !== null && !lock.locked;
	useEffect(() => {
		if (!unlocked) return;
		let cancelled = false;
		const read = () => {
			window.juno.agent.actions
				.pendingCount()
				.then((count) => {
					if (!cancelled) setPendingActions(count);
				})
				.catch(() => undefined);
		};
		read();
		const off = window.juno.agent.actions.onChange(() => read());
		return () => {
			cancelled = true;
			off();
		};
	}, [unlocked]);

	// Until the first state arrives, render nothing rather than a flash of the
	// application behind a lock screen that is about to appear.
	if (lock === null) return <div className="h-full bg-[var(--paper)]" />;

	if (lock.locked) {
		return (
			<LockScreen
				state={lock}
				onUnlocked={() => void window.juno.lock.state().then(setLock)}
			/>
		);
	}

	const navigate = (id: ScreenId) => {
		setScreen(id);
		// On a narrow window the sidebar is covering the thing just chosen.
		if (sidebar.floating) sidebar.close();
	};

	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			<TitleBar
				title={SCREEN_LABELS[screen]}
				sidebarCollapsed={sidebar.collapsed}
				onToggleSidebar={sidebar.toggle}
			/>
			<div className="relative flex min-h-0 flex-1">
				{sidebar.visible ? (
					<Sidebar
						current={screen}
						onNavigate={navigate}
						pendingActions={pendingActions}
						collapsed={sidebar.collapsed}
						floating={sidebar.floating}
						onOpenSettings={() => void window.juno.window.openSettings()}
						lockConfigured={lock.configured}
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
					) : screen === "agent" ? (
						<AgentScreen />
					) : screen === "templates" ? (
						<TemplatesScreen />
					) : (
						<Placeholder title={SCREEN_LABELS[screen]} />
					)}
				</main>
			</div>
		</div>
	);
}

function Placeholder({ title }: { title: string }) {
	return (
		<div className="p-8">
			<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
				{title}
			</h1>
			<p className="mt-3 max-w-[60ch] text-[var(--ink-muted)]">
				Not built yet. See PLAN.md for which phase this arrives in.
			</p>
		</div>
	);
}
