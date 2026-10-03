import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AppInfo, SettingsSection } from "@shared/types";
import { Toast } from "../components/Toast";
import { AccountingSection } from "../features/settings/AccountingSection";
import { AppearanceSection } from "../features/settings/AppearanceSection";
import { BackupSection } from "../features/settings/BackupSection";
import { CertificateSection } from "../features/settings/CertificateSection";
import { LockSection } from "../features/settings/LockSection";
import { MailSection } from "../features/settings/MailSection";
import { OnboardingSection } from "../features/settings/OnboardingSection";
import { OwnerSection } from "../features/settings/OwnerSection";
import { PageHeader } from "../features/settings/PageHeader";
import { firstPageOf, pageById, pageOfAnchor, type SettingsPageId } from "../features/settings/pages";
import { ReferenceSection } from "../features/settings/ReferenceSection";
import { SearchResults } from "../features/settings/SearchResults";
import { searchSettings, resultId, type SettingEntry } from "../features/settings/search";
import { Section } from "../features/settings/Section";
import { PAGE_PADDING, SoloSectionContext } from "../features/settings/section-layout";
import { SettingsNav } from "../features/settings/SettingsNav";
import { SignatureSection } from "../features/settings/SignatureSection";
import { UpdatesSection } from "../features/settings/UpdatesSection";
import { ConnectionPanel } from "../features/agent/ConnectionPanel";
import { PairingDialog } from "../features/agent/PairingDialog";
import { messageOf } from "../lib/errors";
import { overlayGutter } from "../lib/platform";
import { useTheme } from "../lib/theme";

type SettingsWindowProps = {
	/**
	 * The group to open on, from the window's own URL. Null is the ordinary case:
	 * somebody opened settings rather than being sent to one part of it.
	 */
	initialSection: SettingsSection | null;
};

/**
 * The settings window.
 *
 * It is a fixed size (main/windows/settings-window.ts), so what it holds is cut
 * to fit: six groups on the left, each made of short pages that show one
 * subject, and the search above them. Nothing here is a long scroll, and the
 * search does not hide in the title bar.
 */
export function SettingsWindow({ initialSection }: SettingsWindowProps) {
	const [theme, setTheme] = useTheme();
	const [page, setPage] = useState<SettingsPageId>(firstPageOf(initialSection ?? "general"));
	const [toast, setToast] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	// The section a search result asked for, kept until the page has painted it.
	const [jumpTo, setJumpTo] = useState<{ anchor: string; nonce: number } | null>(null);
	const main = useRef<HTMLElement>(null);
	const searchField = useRef<HTMLInputElement>(null);
	const resultsId = useId();

	const searching = query.trim() !== "";
	const results = useMemo(() => searchSettings(query), [query]);

	// Escape closes a modal dialog, and this window is one.
	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => {
			// The search field takes its own Escape, to clear itself first.
			if (event.key === "Escape" && !event.defaultPrevented) void window.juno.window.closeSettings();
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
				event.preventDefault();
				searchField.current?.focus();
				searchField.current?.select();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	function changeQuery(next: string) {
		setQuery(next);
		setActive(0);
		main.current?.scrollTo({ top: 0 });
	}

	// A page opens at its top. Done here, where the person moved, rather than in
	// an effect that would also fire when a search result scrolls to its section.
	function goToPage(id: SettingsPageId) {
		setQuery("");
		setPage(id);
		main.current?.scrollTo({ top: 0 });
	}

	function pick(entry: SettingEntry) {
		setQuery("");
		setPage(pageOfAnchor(entry.anchor)?.id ?? firstPageOf(entry.tab));
		main.current?.scrollTo({ top: 0 });
		setJumpTo({ anchor: entry.anchor, nonce: Date.now() });
	}

	function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown" && results.length > 0) {
			event.preventDefault();
			setActive((current) => (current + 1) % results.length);
		} else if (event.key === "ArrowUp" && results.length > 0) {
			event.preventDefault();
			setActive((current) => (current - 1 + results.length) % results.length);
		} else if (event.key === "Enter") {
			const entry = results[active];
			if (entry) {
				event.preventDefault();
				pick(entry);
			}
		} else if (event.key === "Escape" && query !== "") {
			// While there is something to clear, this press is for the search.
			event.preventDefault();
			changeQuery("");
		}
	}

	// The page renders after the state change, and a section that loads its own
	// data may take a frame or two more, so look for it a few times.
	useEffect(() => {
		if (!jumpTo) return;
		let frame = 0;
		let tries = 0;
		const look = () => {
			const target = main.current?.querySelector<HTMLElement>(`[data-setting="${jumpTo.anchor}"]`);
			if (!target) {
				if (++tries < 20) frame = requestAnimationFrame(look);
				else setJumpTo(null);
				return;
			}
			const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			target.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
			if (!still) {
				target.animate(
					[{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }],
					{ duration: 1600, easing: "ease-out" },
				);
			}
			setJumpTo(null);
		};
		frame = requestAnimationFrame(look);
		return () => cancelAnimationFrame(frame);
	}, [jumpTo]);

	// Asked for a group while this window was already open, so it could not ride
	// in the URL. Reloading instead would throw away a half-typed field.
	useEffect(
		() =>
			window.juno.window.onShowSection((group) => {
				setQuery("");
				setPage(firstPageOf(group));
			}),
		[],
	);

	const current = pageById(page);

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
				<SettingsNav
					page={page}
					onPage={goToPage}
					query={query}
					onQuery={changeQuery}
					onSearchKeyDown={onSearchKeyDown}
					searchRef={searchField}
					activeResultId={searching && results.length > 0 ? resultId(resultsId, active) : undefined}
					resultsId={resultsId}
				/>

				{/*
					Unpadded on purpose. A page that turns into a form page draws its
					own header and footer against the window edges, so the padding
					belongs to the pages rather than to the frame. The gutter is
					reserved so a page that scrolls does not shift the one that does not.
				*/}
				<main ref={main} className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
					{searching ? (
						<SearchResults
							id={resultsId}
							query={query}
							results={results}
							active={active}
							onActive={setActive}
							onPick={pick}
							onSuggest={changeQuery}
						/>
					) : (
						<SoloSectionContext.Provider value={current.solo}>
							{page === "mail" ? (
								<MailSection onSaved={setToast} header={<PageHeader page={current} />} />
							) : (
								<div className={PAGE_PADDING}>
									<PageHeader page={current} />
									{/* Wrapped, so the first section is the first child and drops its rule. */}
									<div>
										<PageBody
											page={page}
											theme={theme}
											onTheme={setTheme}
											onNotice={setToast}
										/>
									</div>
								</div>
							)}
						</SoloSectionContext.Provider>
					)}
				</main>
			</div>

			<PairingDialog onConnected={(name) => setToast(`${name} connected.`)} />

			{toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
		</div>
	);
}

type PageBodyProps = {
	page: SettingsPageId;
	theme: ReturnType<typeof useTheme>[0];
	onTheme: ReturnType<typeof useTheme>[1];
	onNotice: (message: string) => void;
};

/** What each page holds. The mail page is drawn by the window, since it takes its own edges. */
function PageBody({ page, theme, onTheme, onNotice }: PageBodyProps): ReactNode {
	switch (page) {
		case "appearance":
			return (
				<AppearanceSection theme={theme} onChange={onTheme} />
			);
		case "updates":
			return <UpdatesSection />;
		case "about":
			return (
				<>
					<OnboardingSection onNotice={onNotice} />
					<AboutSection />
				</>
			);
		case "details":
			return <OwnerSection part="details" onSaved={onNotice} />;
		case "contact":
			return <OwnerSection part="contact" onSaved={onNotice} />;
		case "accounting":
			return <AccountingSection onSaved={onNotice} />;
		case "statuses":
			return <ReferenceSection />;
		case "signature":
			return <SignatureSection />;
		case "certificate":
			return <CertificateSection />;
		case "lock":
			return <LockSection />;
		case "backup":
			return <BackupSection onDone={onNotice} />;
		case "mcp-server":
			return <ConnectionPanel part="server" onNotice={onNotice} />;
		case "mcp-connect":
			return <ConnectionPanel part="connect" onNotice={onNotice} />;
		case "mcp-tools":
			return <ConnectionPanel part="tools" onNotice={onNotice} />;
		case "mail":
			return null;
	}
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
		<Section title="About" anchor="about" description="Where this installation keeps its data.">
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
						<span data-selectable className="break-all">
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
