import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MailThreadSummary } from "@shared/types";
import { Avatar } from "../components/Avatar";
import { Icon, type IconName } from "../components/Icon";
import { Kbd } from "../components/Kbd";
import { requestOpenClient } from "../lib/open-client";
import { requestOpen } from "../lib/open-entity";
import { rank } from "../lib/palette-search";
import { COMBOS, SCREEN_COMBOS, formatCombo } from "../lib/shortcuts";
import { useLoaded } from "../lib/use-loaded";
import { leadParticipant } from "../features/mail/format";
import type { ScreenId } from "./screens";

type PaletteItem = {
	id: string;
	label: string;
	/** Under the label, muted: the client of a document, the subject of a thread. */
	detail?: string;
	icon?: IconName;
	avatar?: { name: string; shape: "round" | "square" };
	keys?: string[];
	keywords?: string;
	run: () => void;
};

type Section = { title: string; items: PaletteItem[] };

type CommandPaletteProps = {
	onClose: () => void;
	onNavigate: (id: ScreenId) => void;
	/** Asks the shell to bring that screen up with its new-record form open. */
	onNew: (screen: ScreenId) => void;
	onSettings: () => void;
	/** Null when no lock is set up, which takes the command away. */
	onLock: (() => void) | null;
	onHelp: () => void;
};

const loadClients = () => window.juno.clients.list();
const loadProjects = () => window.juno.projects.list();
const loadDocuments = () => window.juno.documents.list();

/** How many of each kind of record are offered. More is scrolling, not finding. */
const PER_KIND = 5;
/** Below this the mail search would match nearly everything, and cost a query for it. */
const MIN_MAIL_QUERY = 2;

/**
 * One box for getting anywhere and starting anything: a screen, a new record,
 * a client, a document, a conversation. It opens over whatever is on screen,
 * and what it opens is the same thing a click would, so it adds no capability
 * of its own: it is the keyboard's route to the ones that are there.
 *
 * The commands filter as you type. Records are searched in what is already
 * loaded, and mail is searched by the same service the mail screen uses, a beat
 * after you stop typing.
 */
export function CommandPalette({ onClose, onNavigate, onNew, onSettings, onLock, onHelp }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [mail, setMail] = useState<{ query: string; rows: MailThreadSummary[] } | null>(null);
	const listId = useId();
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);

	const clients = useLoaded(loadClients);
	const projects = useLoaded(loadProjects);
	const documents = useLoaded(loadDocuments);

	// What had focus before, so closing hands it back instead of dropping it on the page.
	useEffect(() => {
		const before = document.activeElement;
		input.current?.focus();
		return () => {
			if (before instanceof HTMLElement) before.focus();
		};
	}, []);

	const term = query.trim();

	useEffect(() => {
		if (term.length < MIN_MAIL_QUERY) return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			window.juno.mail.threads
				.list({ search: term, limit: PER_KIND })
				.then((rows) => {
					if (!cancelled) setMail({ query: term, rows });
				})
				.catch(() => {
					// A search that fails is a search with no mail in it, not an error in a box
					// that is for getting somewhere quickly.
					if (!cancelled) setMail({ query: term, rows: [] });
				});
		}, 220);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [term]);

	const sections = useMemo<Section[]>(() => {
		const go = (screen: ScreenId) => () => onNavigate(screen);
		const comboKeys = (screen: ScreenId) => {
			const combo = SCREEN_COMBOS[screen];
			return combo ? formatCombo(combo) : undefined;
		};

		const goTo: PaletteItem[] = [
			{ id: "go-overview", label: "Overview", icon: "overview", keys: comboKeys("overview"), keywords: "home dashboard today", run: go("overview") },
			{ id: "go-calendar", label: "Calendar", icon: "calendar", keys: comboKeys("calendar"), keywords: "agenda events appointments", run: go("calendar") },
			{ id: "go-clients", label: "Clients", icon: "clients", keys: comboKeys("clients"), keywords: "customers companies contacts", run: go("clients") },
			{ id: "go-projects", label: "Projects", icon: "projects", keys: comboKeys("projects"), keywords: "work jobs", run: go("projects") },
			{ id: "go-mail", label: "Mail", icon: "mail", keys: comboKeys("mail"), keywords: "inbox email messages", run: go("mail") },
			{ id: "go-styled-mail", label: "Styled mail", icon: "templates", keywords: "mail templates email layouts", run: go("mail-templates") },
			{ id: "go-documents", label: "Documents", icon: "documents", keys: comboKeys("documents"), keywords: "contracts pdf files", run: go("documents") },
			{ id: "go-templates", label: "Templates", icon: "templates", keywords: "document templates contracts letters", run: go("document-templates") },
			{ id: "go-reminders", label: "Reminders", icon: "reminders", keywords: "tasks due todo", run: go("reminders") },
			{ id: "go-agent", label: "Agent", icon: "agent", keys: comboKeys("agent"), keywords: "assistant mcp connection requests", run: go("agent") },
			{ id: "go-settings", label: "Settings", icon: "settings", keys: formatCombo(COMBOS.settings), keywords: "preferences account mail accounts theme", run: onSettings },
		];

		const create: PaletteItem[] = [
			{ id: "new-reminder", label: "New reminder", icon: "add", keywords: "task due", run: () => onNew("overview") },
			{ id: "new-event", label: "New event", icon: "add", keywords: "appointment calendar", run: () => onNew("calendar") },
			{ id: "new-client", label: "New client", icon: "add", keywords: "customer company", run: () => onNew("clients") },
			{ id: "new-project", label: "New project", icon: "add", keywords: "work job", run: () => onNew("projects") },
			{ id: "new-message", label: "New message", icon: "add", keywords: "compose write email mail", run: () => onNew("mail") },
			{ id: "new-document", label: "New document", icon: "add", keywords: "generate contract letter", run: () => onNew("documents") },
		];

		const other: PaletteItem[] = [
			{ id: "help", label: "Keyboard shortcuts", icon: "keyboard", keys: formatCombo(COMBOS.help), keywords: "keys hotkeys cheat sheet help", run: onHelp },
			...(onLock
				? [{ id: "lock", label: "Lock Juno", icon: "lock" as const, keys: formatCombo(COMBOS.lock), keywords: "secure screen", run: onLock }]
				: []),
		];

		if (term === "") {
			return [
				{ title: "Go to", items: goTo },
				{ title: "Create", items: create },
				{ title: "Other", items: other },
			];
		}

		const result: Section[] = [];
		const commands = rank([...goTo, ...create, ...other], term);
		if (commands.length > 0) result.push({ title: "Commands", items: commands });

		const clientRows =
			clients.status === "ready"
				? rank(
						clients.value.map((client): PaletteItem => ({
							id: `client-${client.id}`,
							label: client.name,
							detail: [client.city, client.status?.label].filter(Boolean).join(" · "),
							avatar: { name: client.name, shape: "square" },
							keywords: client.email ?? "",
							run: () => requestOpenClient(client.id, client.name),
						})),
						term,
					).slice(0, PER_KIND)
				: [];
		if (clientRows.length > 0) result.push({ title: "Clients", items: clientRows });

		const projectRows =
			projects.status === "ready"
				? rank(
						projects.value.map((project): PaletteItem => ({
							id: `project-${project.id}`,
							label: project.name,
							detail: project.clientName ?? "",
							avatar: { name: project.name, shape: "square" },
							keywords: `${project.clientName ?? ""} ${project.description ?? ""}`,
							run: () => requestOpen({ kind: "project", id: project.id, name: project.name }),
						})),
						term,
					).slice(0, PER_KIND)
				: [];
		if (projectRows.length > 0) result.push({ title: "Projects", items: projectRows });

		const documentRows =
			documents.status === "ready"
				? rank(
						documents.value.map((record): PaletteItem => ({
							id: `document-${record.id}`,
							label: record.title,
							detail: record.clientName,
							avatar: { name: record.clientName, shape: "square" },
							keywords: record.clientName,
							run: () => requestOpen({ kind: "document", id: record.id, name: record.title }),
						})),
						term,
					).slice(0, PER_KIND)
				: [];
		if (documentRows.length > 0) result.push({ title: "Documents", items: documentRows });

		// Only the answer to what is typed now: the one for the word before it is stale.
		const mailRows =
			mail && mail.query === term
				? mail.rows.map((thread): PaletteItem => {
						const from = leadParticipant(thread.participants);
						return {
							id: `thread-${thread.id}`,
							label: thread.subject || "(no subject)",
							detail: from,
							avatar: { name: from, shape: "round" },
							run: () => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId }),
						};
					})
				: [];
		if (mailRows.length > 0) result.push({ title: "Mail", items: mailRows });

		return result;
	}, [term, clients, projects, documents, mail, onNavigate, onNew, onSettings, onLock, onHelp]);

	const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
	const index = Math.min(active, Math.max(0, flat.length - 1));

	useEffect(() => {
		list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
	}, [index, flat]);

	function choose(item: PaletteItem | undefined) {
		if (!item) return;
		onClose();
		// After the palette has gone, so what it opens lands on a screen with nothing over it.
		window.setTimeout(item.run, 0);
	}

	function onKeyDown(event: React.KeyboardEvent) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive(flat.length === 0 ? 0 : (index + 1) % flat.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive(flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length);
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(flat[index]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			// The window listeners of whatever is underneath would take this as their own.
			event.stopPropagation();
			onClose();
		} else if (event.key === "Tab") {
			// The box is the one thing to focus. Tabbing out of it into the page behind
			// a layer that is meant to be modal is how a keyboard gets lost.
			event.preventDefault();
		}
	}

	// Where each section starts in the flat list, so a row knows its own position.
	const starts: number[] = [];
	let offset = 0;
	for (const section of sections) {
		starts.push(offset);
		offset += section.items.length;
	}

	return createPortal(
		<div
			data-popover-root
			className="animate-fade fixed inset-0 z-[80] flex items-start justify-center bg-[var(--ink)]/25 px-6 pt-[13vh]"
			style={{ backdropFilter: "blur(var(--overlay-blur))" }}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Search and commands"
				data-palette
				onKeyDown={onKeyDown}
				className="animate-scale flex max-h-[min(560px,72vh)] w-[min(640px,100%)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)]"
				style={{ boxShadow: "var(--shadow-modal)" }}
			>
				<div className="flex h-12 flex-none items-center gap-3 border-b border-[var(--line)] px-4">
					<Icon name="search" size={16} className="flex-none text-[var(--ink-muted)]" />
					<input
						ref={input}
						type="text"
						role="combobox"
						aria-expanded
						aria-controls={listId}
						aria-activedescendant={flat[index] ? `${listId}-${flat[index].id}` : undefined}
						aria-label="Search or jump to"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						placeholder="Search or jump to"
						spellCheck={false}
						autoComplete="off"
						className="min-w-0 flex-1 bg-transparent text-[length:var(--text-lg)] text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
					/>
					<Kbd keys={["Esc"]} />
				</div>

				<div ref={list} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
					{flat.length === 0 ? (
						<p className="px-3 py-8 text-center text-[length:var(--text-dense)] text-[var(--ink-muted)]">
							Nothing matches.
						</p>
					) : (
						sections.map((section, sectionIndex) => (
							<div key={section.title} role="group" aria-label={section.title}>
								<p className="px-3 pt-3 pb-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)] first:pt-1">
									{section.title}
								</p>
								{section.items.map((item, itemIndex) => {
									const mine = (starts[sectionIndex] ?? 0) + itemIndex;
									const isActive = mine === index;
									return (
										<div
											key={item.id}
											id={`${listId}-${item.id}`}
											role="option"
											aria-selected={isActive}
											data-active={isActive}
											onMouseMove={() => {
												if (active !== mine) setActive(mine);
											}}
											onClick={() => choose(item)}
											className={[
												"flex h-11 cursor-default items-center gap-3 rounded-[var(--radius-md)] px-3 transition-colors duration-[var(--duration-fast)]",
												isActive ? "bg-[var(--hover)]" : "",
											].join(" ")}
										>
											{item.avatar ? (
												<Avatar name={item.avatar.name} size={24} shape={item.avatar.shape} />
											) : (
												<span className="flex h-6 w-6 flex-none items-center justify-center text-[var(--ink-muted)]">
													{item.icon ? <Icon name={item.icon} size={16} strokeWidth={1.9} /> : null}
												</span>
											)}
											<span className="min-w-0 flex-1 truncate text-[length:var(--text-base)]">
												{item.label}
												{item.detail ? (
													<span className="ml-2 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
														{item.detail}
													</span>
												) : null}
											</span>
											{item.keys ? <Kbd keys={item.keys} /> : null}
											{isActive && !item.keys ? <Kbd keys={["Enter"]} /> : null}
										</div>
									);
								})}
							</div>
						))
					)}
				</div>

				<div className="flex h-9 flex-none items-center gap-4 border-t border-[var(--line)] px-4 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
					<span className="flex items-center gap-1.5">
						<Kbd keys={["↑", "↓"]} /> move
					</span>
					<span className="flex items-center gap-1.5">
						<Kbd keys={["Enter"]} /> open
					</span>
					<span className="flex items-center gap-1.5">
						<Kbd keys={["Esc"]} /> close
					</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}
