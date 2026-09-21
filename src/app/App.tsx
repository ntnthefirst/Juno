import { useEffect, useState } from "react";
import type { LockState } from "@shared/types";
import { LockScreen } from "../components/LockScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { ClientsScreen } from "../features/clients/ClientsScreen";
import { DocumentsScreen } from "../features/documents/DocumentsScreen";
import { MailScreen } from "../features/mail/MailScreen";
import { RemindersScreen } from "../features/reminders/RemindersScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { TemplatesScreen } from "../features/templates/TemplatesScreen";
import { TodayScreen } from "../features/today/TodayScreen";
import { useTheme } from "../lib/theme";
import { Sidebar, type ScreenId } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function App() {
	const [theme, setTheme] = useTheme();
	const [screen, setScreen] = useState<ScreenId>("today");
	const [lock, setLock] = useState<LockState | null>(null);

	useEffect(() => {
		void window.bureau.lock.state().then(setLock);
		// The main process locks on idle, sleep and minimise without being asked,
		// so the interface has to be told rather than poll.
		return window.bureau.lock.onChange(setLock);
	}, []);

	// Until the first state arrives, render nothing rather than a flash of the
	// application behind a lock screen that is about to appear.
	if (lock === null) return <div className="h-full bg-[var(--paper)]" />;

	if (lock.locked) {
		return (
			<LockScreen
				state={lock}
				onUnlocked={() => void window.bureau.lock.state().then(setLock)}
			/>
		);
	}

	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			<TitleBar theme={theme} onThemeChange={setTheme} lockConfigured={lock.configured} />
			<div className="flex min-h-0 flex-1">
				<Sidebar current={screen} onNavigate={setScreen} />
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
						<TemplatesScreen />
					) : screen === "settings" ? (
						<SettingsScreen theme={theme} onThemeChange={setTheme} />
					) : (
						<Placeholder title={LABELS[screen]} />
					)}
				</main>
			</div>
		</div>
	);
}

const LABELS: Record<ScreenId, string> = {
	today: "Today",
	clients: "Clients",
	projects: "Projects",
	documents: "Documents",
	mail: "Mail",
	calendar: "Calendar",
	reminders: "Reminders",
	templates: "Templates",
	settings: "Settings",
};

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
