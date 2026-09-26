import { useEffect, useState } from "react";
import type { AppInfo, SettingsSection } from "@shared/types";
import { Toast } from "../components/Toast";
import { AccountingSection } from "../features/settings/AccountingSection";
import { AppearanceSection } from "../features/settings/AppearanceSection";
import { BackupSection } from "../features/settings/BackupSection";
import { LockSection } from "../features/settings/LockSection";
import { MailSection } from "../features/settings/MailSection";
import { OnboardingSection } from "../features/settings/OnboardingSection";
import { OwnerSection } from "../features/settings/OwnerSection";
import { ReferenceSection } from "../features/settings/ReferenceSection";
import { Section } from "../features/settings/Section";
import { SignatureSection } from "../features/settings/SignatureSection";
import { UpdatesSection } from "../features/settings/UpdatesSection";
import { ConnectionPanel } from "../features/agent/ConnectionPanel";
import { messageOf } from "../lib/errors";
import { overlayGutter } from "../lib/platform";
import { useTheme } from "../lib/theme";

type SettingsWindowProps = {
	/**
	 * The tab to open on, from the window's own URL. Null is the ordinary case:
	 * somebody opened settings rather than being sent to one page of it.
	 */
	initialSection: SettingsSection | null;
};

const TABS: { id: SettingsSection; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "business", label: "Your business" },
	{ id: "mail", label: "Mail accounts" },
	{ id: "documents", label: "Documents" },
	{ id: "security", label: "Security and data" },
	{ id: "mcp", label: "MCP" },
];

/**
 * The settings window.
 *
 * It is a fixed size (main/windows/settings-window.ts), so the sections are
 * split across tabs rather than stacked in one long scroll. One column of
 * fields, one subject at a time, nothing that needs a wider window.
 */
export function SettingsWindow({ initialSection }: SettingsWindowProps) {
	const [theme, setTheme] = useTheme();
	// Null until the stored value is in, so the checkbox does not flash a
	// state it is about to leave.
	const [autoCollapse, setAutoCollapse] = useState<boolean | null>(null);
	const [tab, setTab] = useState<SettingsSection>(initialSection ?? "general");
	const [toast, setToast] = useState<string | null>(null);

	// Escape closes a modal dialog, and this window is one.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") void window.juno.window.closeSettings();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		void window.juno.settings.getSidebarAutoCollapse().then(setAutoCollapse);
	}, []);

	function changeAutoCollapse(next: boolean) {
		setAutoCollapse(next);
		window.juno.settings
			.setSidebarAutoCollapse(next)
			.then(setAutoCollapse)
			.catch((cause: unknown) => {
				setAutoCollapse(!next);
				setToast(messageOf(cause));
			});
	}

	// Asked for a tab while this window was already open, so it could not ride
	// in the URL. Reloading instead would throw away a half-typed field.
	useEffect(() => window.juno.window.onShowSection(setTab), []);

	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			<header
				className="drag-region flex flex-none items-center border-b border-[var(--line)]"
				style={{
					height: "var(--titlebar-height)",
					paddingLeft: overlayGutter.left,
					paddingRight: overlayGutter.right,
				}}
			>
				<span className="text-[length:var(--text-sm)] font-[var(--weight-semibold)]">Settings</span>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav
					aria-label="Settings sections"
					className="flex w-[196px] flex-none flex-col gap-px overflow-y-auto border-r border-[var(--line)] p-2"
				>
					{TABS.map((item) => (
						<button
							key={item.id}
							type="button"
							aria-current={item.id === tab ? "page" : undefined}
							onClick={() => setTab(item.id)}
							style={{ height: "var(--row-height)" }}
							className={[
								"flex w-full items-center rounded-[var(--radius-md)] px-3 text-left transition-colors",
								item.id === tab
									? "bg-[var(--accent-soft)] font-[var(--weight-medium)] text-[var(--accent)]"
									: "text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
							].join(" ")}
						>
							<span className="min-w-0 truncate">{item.label}</span>
						</button>
					))}
				</nav>

				{/*
					Unpadded on purpose. A section that turns into a form page draws its
					own header and footer against the window edges, so the padding
					belongs to the sections rather than to the frame.
				*/}
				<main className="min-w-0 flex-1 overflow-y-auto">
					{tab === "general" ? (
						<Pad>
							<AppearanceSection
								theme={theme}
								onChange={setTheme}
								sidebarAutoCollapse={autoCollapse}
								onSidebarAutoCollapseChange={changeAutoCollapse}
							/>
							<OnboardingSection onNotice={setToast} />
							<UpdatesSection />
							<AboutSection />
						</Pad>
					) : tab === "business" ? (
						<Pad>
							<OwnerSection onSaved={setToast} />
							<AccountingSection onSaved={setToast} />
						</Pad>
					) : tab === "mail" ? (
						<MailSection onSaved={setToast} />
					) : tab === "documents" ? (
						<Pad>
							<ReferenceSection />
							<SignatureSection />
						</Pad>
					) : tab === "mcp" ? (
						<Pad>
							<ConnectionPanel onNotice={setToast} />
						</Pad>
					) : (
						<Pad>
							<LockSection />
							<BackupSection onDone={setToast} />
						</Pad>
					)}
				</main>
			</div>

			{toast ? (
				<Toast
					message={toast}
					onDismiss={() => setToast(null)}
				/>
			) : null}
		</div>
	);
}

/** The breathing room around a settings section that is not a form page. */
function Pad({ children }: { children: React.ReactNode }) {
	return <div className="px-6 py-5">{children}</div>;
}

function AboutSection() {
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.juno.app
			.info()
			.then((value) => {
				if (!cancelled) setInfo(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Section
			title="About"
			description="Where this installation keeps its data. The version is under Updates."
		>
			{error ? (
				<p className="text-[var(--risk)]">{error}</p>
			) : info === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<dl className="flex flex-col gap-2 text-[length:var(--text-dense)]">
					<Row label="Platform">
						{info.platform}
						{info.isDev ? ", development build" : ""}
					</Row>
					<Row label="Database">
						<span
							data-selectable
							className="break-all"
						>
							{info.databasePath}
						</span>
					</Row>
				</dl>
			)}
		</Section>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-4">
			<dt className="w-[92px] shrink-0 text-[var(--ink-muted)]">{label}</dt>
			<dd className="min-w-0">{children}</dd>
		</div>
	);
}
