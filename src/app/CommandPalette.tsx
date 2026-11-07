import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MailThreadSummary } from "@shared/types";
import { Icon, type IconName } from "../components/Icon";
import { Kbd } from "../components/Kbd";
import { requestOpenClient } from "../lib/open-client";
import { requestOpen } from "../lib/open-entity";
import { rank } from "../lib/palette-search";
import { listAllClients } from "../lib/list-all-clients";
import { COMBOS, SCREEN_COMBOS, formatCombo } from "../lib/shortcuts";
import { useLoaded } from "../lib/use-loaded";
import { leadParticipant } from "../features/mail/format";
import type { ScreenAction } from "../lib/screen-actions";
import type { ScreenId } from "./screens";
import { belongsTo } from "../features/documents/belongs-to";
import { noteTitleFallback } from "../features/notes/note-format";

type PaletteItem = {
	id: string;
	label: string;
	/** Under the label, muted: the client of a document, the sender of a thread. */
	detail?: string;
	icon?: IconName;
	/** Drawn on a tile with the kind of record, and named at the right. */
	record?: string;
	keys?: string[];
	keywords?: string;
	run: () => void;
};

type Section = { title: string; items: PaletteItem[] };

/** Where a search looks. Tab moves along these, the way the tabs under the box do. */
type Scope = "all" | "client" | "project" | "mail" | "note" | "document";

const SCOPES: { id: Scope; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "client", label: "Clients" },
	{ id: "project", label: "Projects" },
	{ id: "mail", label: "Mail" },
	{ id: "note", label: "Notes" },
	{ id: "document", label: "Documents" },
];

type CommandPaletteProps = {
	onClose: () => void;
	onNavigate: (id: ScreenId) => void;
	/** Asks the shell to bring that screen up with its new-record form open. */
	onNew: (screen: ScreenId, action?: ScreenAction) => void;
	onSettings: () => void;
	/** Null when no lock is set up, which takes the command away. */
	onLock: (() => void) | null;
	onHelp: () => void;
};

const RECORD_LABEL: Record<string, string> = {
	clients: "Clients",
	projects: "Projects",
	mail: "Mail",
	note: "Notes",
	documents: "Documents",
};

const loadClients = () => listAllClients();
const loadProjects = () => window.juno.projects.list();
const loadDocuments = () => window.juno.documents.list();
const loadNotes = () => window.juno.notes.list();

/** How many of each kind of record are offered under All. More is scrolling, not finding. */
const PER_KIND = 4;
/** And how many when one kind is picked, since the whole box is then for it. */
const PER_KIND_SCOPED = 20;
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
	const [scope, setScope] = useState<Scope>("all");
	const [mail, setMail] = useState<{ query: string; rows: MailThreadSummary[] } | null>(null);
	const listId = useId();
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);

	const clients = useLoaded(loadClients);
	const projects = useLoaded(loadProjects);
	const documents = useLoaded(loadDocuments);
	const notes = useLoaded(loadNotes);

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
				.list({ search: term, limit: PER_KIND_SCOPED })
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
			{ id: "go-notes", label: "Notes", icon: "note", keys: comboKeys("notes"), keywords: "jottings checklist write", run: go("notes") },
			{ id: "go-documents", label: "Documents", icon: "documents", keys: comboKeys("documents"), keywords: "contracts pdf files", run: go("documents") },
			{ id: "go-templates", label: "Templates", icon: "templates", keywords: "document templates contracts letters", run: go("document-templates") },
			{ id: "go-reminders", label: "Reminders", icon: "reminders", keys: formatCombo(COMBOS.reminders), keywords: "tasks due todo", run: go("reminders") },
			{ id: "go-agent", label: "Agent", icon: "agent", keys: comboKeys("agent"), keywords: "assistant mcp connection requests", run: go("agent") },
			{ id: "go-settings", label: "Settings", icon: "settings", keys: formatCombo(COMBOS.settings), keywords: "preferences account mail accounts theme", run: onSettings },
		];

		const create: PaletteItem[] = [
			{ id: "new-note", label: "New note", icon: "add", keywords: "write jot checklist", run: () => onNew("notes") },
			{ id: "new-page", label: "New page", icon: "add", keywords: "write document quote", keys: formatCombo(COMBOS.newPage), run: () => onNew("documents", "new-page") },
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
				{ title: "New", items: create },
				{ title: "Other", items: other },
			];
		}

		const result: Section[] = [];
		const cap = scope === "all" ? PER_KIND : PER_KIND_SCOPED;
		const commands = scope === "all" ? rank([...goTo, ...create, ...other], term) : [];
		if (commands.length > 0) result.push({ title: "Go to", items: commands.slice(0, PER_KIND) });

		const clientRows =
			(scope === "all" || scope === "client") && clients.status === "ready"
				? rank(
						clients.value.map((client): PaletteItem => ({
							id: `client-${client.id}`,
							label: client.name,
							detail: [client.city, client.status?.label].filter(Boolean).join(" · "),
							record: "clients",
							keywords: client.email ?? "",
							run: () => requestOpenClient(client.id, client.name),
						})),
						term,
					).slice(0, cap)
				: [];
		if (clientRows.length > 0) result.push({ title: "Clients", items: clientRows });

		const projectRows =
			(scope === "all" || scope === "project") && projects.status === "ready"
				? rank(
						projects.value.map((project): PaletteItem => ({
							id: `project-${project.id}`,
							label: project.name,
							detail: project.clientName ?? "",
							record: "projects",
							keywords: `${project.clientName ?? ""} ${project.description ?? ""}`,
							run: () => requestOpen({ kind: "project", id: project.id, name: project.name }),
						})),
						term,
					).slice(0, cap)
				: [];
		if (projectRows.length > 0) result.push({ title: "Projects", items: projectRows });

		const documentRows =
			(scope === "all" || scope === "document") && documents.status === "ready"
				? rank(
						documents.value.map((record): PaletteItem => ({
							id: `document-${record.id}`,
							label: record.title,
							detail: belongsTo(record),
							record: "documents",
							keywords: belongsTo(record),
							run: () => requestOpen({ kind: "document", id: record.id, name: record.title }),
						})),
						term,
					).slice(0, cap)
				: [];
		if (documentRows.length > 0) result.push({ title: "Documents", items: documentRows });

		const noteRows =
			(scope === "all" || scope === "note") && notes.status === "ready"
				? rank(
						notes.value.map((note): PaletteItem => ({
							id: `note-${note.id}`,
							label: note.title || noteTitleFallback(note.body),
							detail: note.clientName ?? note.projectName ?? "",
							record: "note",
							keywords: note.body.slice(0, 400),
							run: () => requestOpen({ kind: "note", id: note.id }),
						})),
						term,
					).slice(0, cap)
				: [];
		if (noteRows.length > 0) result.push({ title: "Notes", items: noteRows });

		// Only the answer to what is typed now: the one for the word before it is stale.
		const mailRows =
			(scope === "all" || scope === "mail") && mail && mail.query === term
				? mail.rows.slice(0, cap).map((thread): PaletteItem => {
						const from = leadParticipant(thread.participants);
						return {
							id: `thread-${thread.id}`,
							label: thread.subject || "(no subject)",
							detail: from,
							record: "mail",
							run: () => requestOpen({ kind: "thread", id: thread.id, messageId: thread.messageId }),
						};
					})
				: [];
		if (mailRows.length > 0) result.push({ title: "Mail", items: mailRows });

		return result;
	}, [term, scope, clients, projects, documents, notes, mail, onNavigate, onNew, onSettings, onLock, onHelp]);

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
			// a layer that is meant to be modal is how a keyboard gets lost, so Tab
			// changes where the search looks instead.
			event.preventDefault();
			if (term !== "") {
				const here = SCOPES.findIndex((entry) => entry.id === scope);
				const step = event.shiftKey ? -1 : 1;
				setScope(SCOPES[(here + step + SCOPES.length) % SCOPES.length]?.id ?? "all");
				setActive(0);
			}
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
				<div className="flex flex-none items-center gap-3 border-b border-[var(--line)] px-4 py-3.5">
					<Icon name="search" size={18} className="flex-none text-[var(--ink-muted)]" />
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
						className="min-w-0 flex-1 bg-transparent text-lg text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
					/>
					{term === "" ? <Kbd keys={formatCombo(COMBOS.palette)} /> : <span className="font-mono text-micro text-[var(--ink-faint)]">Esc</span>}
				</div>

				{term !== "" ? (
					<div role="tablist" aria-label="Where to look" className="flex flex-none items-center gap-1.5 px-4 pt-2.5 pb-1.5">
						{SCOPES.map((entry) => (
							<button
								key={entry.id}
								type="button"
								role="tab"
								tabIndex={-1}
								aria-selected={scope === entry.id}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									setScope(entry.id);
									setActive(0);
								}}
								className={[
									"rounded-[var(--radius-md)] px-2.5 py-1 text-dense font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)]",
									scope === entry.id
										? "bg-[var(--hover)] text-[var(--ink)]"
										: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
								].join(" ")}
							>
								{entry.label}
							</button>
						))}
					</div>
				) : null}

				<div ref={list} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
					{flat.length === 0 ? (
						<p className="px-3 py-8 text-center text-dense text-[var(--ink-muted)]">
							Nothing matches.
						</p>
					) : (
						sections.map((section, sectionIndex) => (
							<div key={section.title} role="group" aria-label={section.title}>
								<p className="px-3 pt-2.5 pb-1 text-overline uppercase text-[var(--ink-muted)] first:pt-1">
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
												"flex cursor-default items-center gap-3 rounded-[var(--radius-md)] px-3 transition-colors duration-[var(--duration-fast)]",
												item.record ? "py-2" : "h-9",
												isActive ? (item.record ? "bg-[var(--hover)]" : "bg-[var(--accent-soft)] text-[var(--accent)]") : "",
											].join(" ")}
										>
											{item.record ? (
												<span className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--sunken)] text-[var(--ink-muted)]">
													<Icon name={item.record as IconName} size={16} strokeWidth={1.9} />
												</span>
											) : (
												<span className={`flex h-6 w-6 flex-none items-center justify-center ${isActive ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"}`}>
													{item.icon ? <Icon name={item.icon} size={16} strokeWidth={1.9} /> : null}
												</span>
											)}
											<span className="min-w-0 flex-1">
												<span className={`block truncate text-base ${item.record ? "font-[var(--weight-medium)]" : ""}`}>{item.label}</span>
												{item.detail ? (
													<span className="block truncate text-sm text-[var(--ink-muted)]">{item.detail}</span>
												) : null}
											</span>
											{item.record ? (
												<span className="flex-none text-dense text-[var(--ink-faint)]">{RECORD_LABEL[item.record]}</span>
											) : null}
											{item.keys ? (
												<span className="flex-none font-mono text-micro text-[var(--ink-faint)]">{item.keys.join(" ")}</span>
											) : null}
										</div>
									);
								})}
							</div>
						))
					)}
				</div>

				{term !== "" ? (
					<div className="flex flex-none items-center gap-4 bg-[var(--sunken)] px-4 py-2.5 text-sm text-[var(--ink-muted)]">
						<span>Enter to open</span>
						<span>Tab to change where it looks</span>
						<span>{formatCombo(COMBOS.find).join(" ")} finds inside the page you are on</span>
					</div>
				) : null}
			</div>
		</div>,
		document.body,
	);
}
