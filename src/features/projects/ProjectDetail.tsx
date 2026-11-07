import { useCallback, useEffect, useState } from "react";
import type {
	Client,
	Project,
	ProjectAsset,
	ProjectCommand,
	ProjectLink,
	ProjectRun,
	ProjectSummary,
	ReferenceItem,
	TimeEntry,
} from "@shared/types";
import { TitleBarSlot } from "../../app/TitleBarSlot";
import { ActionMenu } from "../../components/ActionMenu";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { MarkdownNotes } from "../../components/MarkdownNotes";
import { MenuButton } from "../../components/Menu";
import type { MenuHandlers } from "../../lib/native-menu";
import { StatusBadge } from "../../components/StatusBadge";
import { Tabs, type TabItem } from "../../components/Tabs";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { requestOpen } from "../../lib/open-entity";
import { COMBOS, matchesCombo } from "../../lib/shortcuts";
import { addDays, todayIso } from "../calendar/dates";
import { openNewRecord } from "../../lib/new-record";
import type { ScheduleForm } from "../calendar/schedule-form";
import { scheduleRows, type ScheduleRow } from "../calendar/schedule-rows";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { LinkedNotes } from "../notes/LinkedNotes";
import { AssetList } from "./AssetList";
import { CommandPanel } from "./CommandPanel";
import { formatCents, formatDate, LINK_ICONS, pathTail } from "./format";
import { LinkMailDialog } from "./LinkMailDialog";
import { LinkPanel } from "./LinkPanel";
import { ProjectCalendar } from "./ProjectCalendar";
import { ProjectMail } from "./ProjectMail";
import { ProjectNotes } from "./ProjectNotes";
import { ProjectTime } from "./ProjectTime";
import { ProjectTimeline } from "./ProjectTimeline";
import { RunConsole } from "./RunConsole";
import { StorageDialog } from "./StorageDialog";
import { dayLabel, formatDuration } from "./time-format";

export type ProjectTab = "notes" | "mail" | "timeline" | "time" | "calendar";

type ProjectDetailProps = {
	projectId: string;
	/** Which tab is open. The screen holds it, so a form page and back lands on the same one. */
	tab: ProjectTab;
	onTabChange: (tab: ProjectTab) => void;
	onBack: () => void;
	/** The list behind this has to read again: a name, a status or a cover changed. */
	onChanged: () => void;
	onEdit: (project: Project) => void;
	/** A date or a reminder is a form, so the screen draws it as a page. */
	onSchedule: (form: ScheduleForm) => void;
	/** So is a document from a template. */
	onGenerateDocument: () => void;
	/** And a time entry, new or edited. */
	onTimeForm: (entry: TimeEntry | null) => void;
	onNameChange: (name: string) => void;
	onDeleted: (project: ProjectSummary) => void;
};

type Loaded = {
	project: Project;
	client: Client | null;
	status: ReferenceItem | null;
	links: ProjectLink[];
	assets: ProjectAsset[];
	commands: ProjectCommand[];
	threadCount: number;
	upcoming: ScheduleRow[];
	loggedMinutes: number;
};

type Load = { status: "loading" } | { status: "ready"; data: Loaded } | { status: "error"; message: string };

/** True while the keyboard is in something that takes text, where Delete means a character. */
function typingIn(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * One project: what it is, what has happened on it, and what is attached.
 *
 * It takes the whole working area rather than sitting beside the list. The
 * header names it and offers Add and the "..." menu; five tabs hold the rest.
 * Notes is the first, with the details beside it and the places and files
 * below. The trail in the title bar says where you are and how to get back.
 */
export function ProjectDetail({
	projectId,
	tab,
	onTabChange,
	onBack,
	onChanged,
	onEdit,
	onSchedule,
	onGenerateDocument,
	onTimeForm,
	onNameChange,
	onDeleted,
}: ProjectDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [runs, setRuns] = useState<ProjectRun[]>([]);
	const [linkPanel, setLinkPanel] = useState<{ link: ProjectLink | null } | null>(null);
	const [commandPanel, setCommandPanel] = useState<{ command: ProjectCommand | null } | null>(null);
	const [storageOpen, setStorageOpen] = useState(false);
	const [linkMailOpen, setLinkMailOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	// Bumped when a change made here adds to what a tab lists, so the tab reads again.
	const [tick, setTick] = useState(0);

	const fetchAll = useCallback(async (): Promise<Loaded> => {
		const project = await window.juno.projects.get(projectId);
		if (!project) throw new Error("That project no longer exists.");

		const today = todayIso();
		const [client, statusSet, links, assets, commands, threads, items, totals] = await Promise.all([
			project.clientId ? window.juno.clients.get(project.clientId) : Promise.resolve(null),
			window.juno.reference.getSet("project_status"),
			window.juno.projects.links.list(projectId),
			window.juno.projects.assets.list(projectId),
			window.juno.projects.commands.list(projectId),
			window.juno.mail.threads.list({ projectId, limit: 100 }),
			window.juno.calendar.list({
				from: today,
				to: addDays(today, 365),
				includeReminders: true,
				projectId,
			}),
			window.juno.time.total(projectId),
		]);

		return {
			project,
			client,
			// Resolved by id and not filtered on hiddenAt: a status the owner has
			// since removed from the pickers still has to render on the records
			// that already carry it. See .claude/rules/data.md section 9.
			status: statusSet?.items.find((item) => item.id === project.statusId) ?? null,
			links,
			assets,
			commands,
			threadCount: threads.length,
			upcoming: scheduleRows(items, today),
			loggedMinutes: totals.loggedMinutes,
		};
	}, [projectId]);

	const reload = useCallback(
		(alsoList = false) => {
			fetchAll()
				.then((data) => {
					setLoad({ status: "ready", data });
					setTick((value) => value + 1);
					onNameChange(data.project.name);
					if (alsoList) onChanged();
				})
				.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
		},
		[fetchAll, onChanged, onNameChange],
	);

	useEffect(() => {
		reload();
	}, [reload]);

	// The logged time follows the timer, wherever it was started or stopped.
	useEffect(() => window.juno.time.onRunningChange(() => reload()), [reload]);

	useEffect(() => {
		void window.juno.projects.runs.list(projectId).then(setRuns).catch(() => setRuns([]));
		return window.juno.projects.runs.onChange((run) => {
			if (run.projectId !== projectId) return;
			setRuns((current) => {
				const rest = current.filter((one) => one.commandId !== run.commandId);
				return [...rest, run];
			});
		});
	}, [projectId]);

	async function act(action: () => Promise<unknown>, alsoList = false) {
		try {
			await action();
			reload(alsoList);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function start(command: ProjectCommand) {
		try {
			const run = await window.juno.projects.runs.start(command.id);
			setRuns((current) => [...current.filter((one) => one.commandId !== run.commandId), run]);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function stop(commandId: string) {
		try {
			await window.juno.projects.runs.stop(commandId);
		} catch (cause: unknown) {
			setNotice(messageOf(cause));
		}
	}

	async function clearRun(commandId: string) {
		await window.juno.projects.runs.clear(commandId);
		setRuns((current) => current.filter((one) => one.commandId !== commandId));
	}

	const data = load.status === "ready" ? load.data : null;
	const opened = data?.project ?? null;

	function openFolder() {
		if (!opened) return;
		// The checkout when there is one, otherwise the folder Juno keeps the files in.
		const opening = opened.localPath
			? window.juno.projects.openLocalFolder(opened.id)
			: window.juno.projects.openStorageFolder(opened.id);
		void opening.catch((cause: unknown) => setNotice(messageOf(cause)));
	}

	function removeProject() {
		if (!data) return;
		const { project: row, client, status, assets, commands } = data;
		void window.juno.projects
			.remove(row.id)
			.then(() =>
				onDeleted({
					id: row.id,
					clientId: row.clientId,
					clientName: client?.name ?? null,
					name: row.name,
					status,
					dueOn: row.dueOn,
					agreedValueCents: row.agreedValueCents,
					description: row.description,
					localPath: row.localPath,
					updatedAt: row.updatedAt,
					coverAssetId: row.coverAssetId,
					linkKinds: [],
					assetCount: assets.length,
					commandCount: commands.length,
				}),
			)
			.catch((cause: unknown) => setNotice(messageOf(cause)));
	}

	// Ctrl O and Delete are on the menu, so they have to work as well as be drawn.
	// Delete is left alone while the keyboard is in a field or the notes editor.
	useEffect(() => {
		if (!opened) return;
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented || document.querySelector("[role='dialog']")) return;
			if (matchesCombo(event, COMBOS.openFolder)) {
				event.preventDefault();
				openFolder();
			} else if (matchesCombo(event, COMBOS.deleteRecord) && !typingIn(event.target)) {
				event.preventDefault();
				removeProject();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	if (load.status === "loading") {
		return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (load.status === "error" || !data) {
		return (
			<div className="p-8">
				<div className="border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not open this project.</p>
					<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
						{load.status === "error" ? load.message : ""}
					</p>
				</div>
				<div className="mt-6">
					<Button onClick={onBack}>Back to projects</Button>
				</div>
			</div>
		);
	}

	const { client, status, links, assets, commands, threadCount, upcoming, loggedMinutes } = data;
	const current = data.project;
	const project = current;
	const firstCommand = commands[0] ?? null;
	const runOf = (commandId: string) => runs.find((one) => one.commandId === commandId) ?? null;
	const nextEvent = upcoming.find((row) => row.kind === "event") ?? null;

	const tabs: TabItem<ProjectTab>[] = [
		{ id: "notes", label: "Notes" },
		{ id: "mail", label: "Mail", count: threadCount > 0 ? threadCount : null, countTone: "warn" },
		{ id: "timeline", label: "Timeline" },
		{ id: "time", label: "Time" },
		{ id: "calendar", label: "Calendar", count: upcoming.length > 0 ? upcoming.length : null, countTone: "warn" },
	];

	// A new event belongs to this project and, when it has one, its client.
	const addEvent = () =>
		openNewRecord("event", {
			projectId: current.id,
			...(current.clientId ? { clientId: current.clientId } : {}),
		});

	// What the platform menus hand back. The items themselves are chosen in the
	// main process from the project (decision 59); this only says what each does.
	const addHandlers: MenuHandlers = {
		"add-mail": () => setLinkMailOpen(true),
		"add-time": () => onTimeForm(null),
		"add-event": () => addEvent(),
		"add-file": () => void act(() => window.juno.projects.assets.choose(current.id, "managed"), true),
		"add-note": () => {
			onTabChange("notes");
			// The editor is on the tab that is about to draw, so it is found a moment later.
			window.setTimeout(() => document.querySelector<HTMLElement>("[aria-label='Project notes']")?.focus(), 60);
		},
	};

	const moreHandlers: MenuHandlers = {
		"change-folder": () =>
			void window.juno.projects
				.chooseLocalFolder()
				.then((chosen) =>
					chosen ? act(() => window.juno.projects.update(current.id, { localPath: chosen }), true) : undefined,
				)
				.catch((cause: unknown) => setNotice(messageOf(cause))),
		"run-start": () => {
			if (firstCommand) void start(firstCommand);
		},
		"stop-start": () => {
			if (firstCommand) void stop(firstCommand.id);
		},
		archive: () =>
			void act(async () => {
				await window.juno.projects.archive(current.id);
				setNotice("Project archived.");
			}, true),
		delete: removeProject,
		done: (message) => setNotice(message ?? null),
		failed: (message) => setNotice(message),
	};

	const subtitle = [client ? client.name : "Your own work", current.dueOn ? `due ${formatDate(current.dueOn)}` : null]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="relative h-full overflow-y-auto">
			<div className="flex w-full flex-col gap-5 p-6">
				<header className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--line)] px-5 py-4">
					<Avatar name={current.name} size={48} shape="square" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-3">
							<h1 className="text-h2">{current.name}</h1>
							{status ? <StatusBadge label={status.label} tone={status.tone} /> : null}
						</div>
						<p className="text-sm text-[var(--ink-muted)]">{subtitle}</p>
					</div>
					<div className="flex flex-none items-center gap-1">
						<ActionMenu target={{ kind: "add", id: current.id }} handlers={addHandlers} ariaLabel="Add to this project" label="Add" icon="add" />
					</div>
					<TitleBarSlot side="overflow">
						<ActionMenu
							target={{ kind: "project", id: current.id, context: "detail" }}
							handlers={moreHandlers}
							ariaLabel="More project actions"
							size="dense"
						/>
					</TitleBarSlot>
				</header>

				<Tabs tabs={tabs} value={tab} onChange={onTabChange} label="Project" />

				{tab === "mail" ? (
					<ProjectMail
						key={current.id}
						projectId={current.id}
						version={tick}
						onLinkMail={() => setLinkMailOpen(true)}
						onChanged={() => reload()}
					/>
				) : tab === "timeline" ? (
					<ProjectTimeline projectId={current.id} version={tick} />
				) : tab === "time" ? (
					<ProjectTime
						projectId={current.id}
						version={tick}
						onAddEntry={() => onTimeForm(null)}
						onEditEntry={(entry) => onTimeForm(entry)}
						onChanged={() => reload()}
					/>
				) : tab === "calendar" ? (
					<ProjectCalendar
						projectId={current.id}
						version={tick}
						onAddEvent={addEvent}
						onOpenForm={onSchedule}
					/>
				) : (
					<>
						<div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
							<section className="min-h-[420px] rounded-[var(--radius-lg)] border border-[var(--line)] p-5">
								<div className="mb-3 flex items-baseline gap-3">
									<h2 className="text-base font-[var(--weight-medium)]">Notes</h2>
									<span className="text-sm text-[var(--ink-muted)]">Saved as you type</span>
								</div>
								<ProjectNotes key={current.id} projectId={current.id} notes={current.notes} />
							</section>

							<aside className="rounded-[var(--radius-lg)] border border-[var(--line)] p-5">
								<div className="flex items-center justify-between">
									<h2 className="text-base font-[var(--weight-medium)]">Details</h2>
									<button
										type="button"
										aria-label="Edit project details"
										title="Edit project details"
										onClick={() => onEdit(current)}
										className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
									>
										<Icon name="edit" size={16} />
									</button>
								</div>
								<dl className="mt-3 flex flex-col gap-4">
									<Detail label="Client" value={client ? client.name : "Your own work"} />
									<Detail label="Status" value={status ? status.label : "No status"} />
									<Detail label="Due date" value={current.dueOn ? formatDate(current.dueOn) : "Not set"} />
									{current.agreedValueCents !== null ? (
										<Detail label="Agreed value" value={formatCents(current.agreedValueCents)} />
									) : null}
									<div className="border-t border-[var(--line)] pt-4">
										<Detail
											label="Mail"
											value={threadCount === 0 ? "Nothing linked" : `${threadCount} ${threadCount === 1 ? "thread" : "threads"} linked`}
										/>
									</div>
									<Detail
										label="Next event"
										value={nextEvent ? `${dayLabel(nextEvent.date)}, ${nextEvent.item.title}` : "Nothing planned"}
									/>
									<Detail label="Time logged" value={formatDuration(loggedMinutes)} />
								</dl>
							</aside>
						</div>

						{runs.length > 0 ? (
							<div className="flex flex-col gap-3">
								{runs.map((run) => (
									<RunConsole
										key={run.commandId}
										run={run}
										onStop={() => void stop(run.commandId)}
										onClear={() => void clearRun(run.commandId)}
									/>
								))}
							</div>
						) : null}

						{current.description ? (
							<section>
								<SectionHeading>About</SectionHeading>
								<MarkdownNotes text={current.description} />
							</section>
						) : null}

						<div>
							{/* Opening one goes to the Documents screen, the same as the palette. */}
							<DocumentsPanel
								scope={{ projectId: current.id }}
								name={current.name}
								onGenerate={onGenerateDocument}
								onOpen={(id, title) => requestOpen({ kind: "document", id, name: title })}
								onChanged={() => undefined}
							/>
						</div>

						<LinkedNotes projectId={current.id} />

				<section>
					<SectionHeading
						action={
							<Button size="dense" data-opens-panel onClick={() => setLinkPanel({ link: null })}>
								<Icon name="add" />
								Add a link
							</Button>
						}
					>
						Links
					</SectionHeading>

					{links.length === 0 ? (
						<p className="text-sm text-[var(--ink-muted)]">
							Nothing linked yet. A repository, a Figma file, a staging address, a folder.
						</p>
					) : (
						<ul className="flex flex-col">
							{links.map((link, index) => (
								<li
									key={link.id}
									className="flex items-center gap-3 border-b border-[var(--line)] px-2"
									style={{ height: "var(--row-height)" }}
								>
									<span className="flex-none text-[var(--ink-faint)]">
										<Icon name={LINK_ICONS[link.kind]} />
									</span>
									<button
										type="button"
										onClick={() =>
											void window.juno.projects.links.open(link.id).catch((cause: unknown) => {
												setNotice(messageOf(cause));
											})
										}
										className="min-w-0 flex-1 truncate text-left text-dense"
										title={link.target}
									>
										{link.label}
									</button>
									<span className="hidden min-w-0 max-w-[40%] flex-none truncate text-micro text-[var(--ink-muted)] sm:block">
										{link.target.startsWith("https://")
											? link.target.replace(/^https:\/\//, "")
											: pathTail(link.target)}
									</span>
									<MenuButton
										ariaLabel={`Actions for ${link.label}`}
										items={[
											{
												id: "open",
												label: "Open",
												icon: "external",
												onSelect: () =>
													void window.juno.projects.links
														.open(link.id)
														.catch((cause: unknown) => setNotice(messageOf(cause))),
											},
											{
												id: "edit",
												label: "Edit",
												icon: "edit",
												onSelect: () => setLinkPanel({ link }),
											},
											{
												id: "up",
												label: "Move up",
												icon: "move-up",
												disabled: index === 0,
												separatorBefore: true,
												onSelect: () => void act(() => move(links, index, -1, "links")),
											},
											{
												id: "down",
												label: "Move down",
												icon: "move-down",
												disabled: index === links.length - 1,
												onSelect: () => void act(() => move(links, index, 1, "links")),
											},
											{
												id: "remove",
												label: "Remove",
												icon: "remove",
												danger: true,
												separatorBefore: true,
												onSelect: () =>
													void act(() => window.juno.projects.links.remove(link.id), true),
											},
										]}
									/>
								</li>
							))}
						</ul>
					)}
				</section>

				<section>
					<SectionHeading
						action={
							<div className="flex items-center gap-2">
								<Button
									size="dense"
									onClick={() =>
										void act(() => window.juno.projects.assets.choose(project.id, "managed"), true)
									}
								>
									<Icon name="add" />
									Add files
								</Button>
								<MenuButton
									ariaLabel="Other ways to add a file"
									items={[
										{
											id: "link",
											label: "Link to files, without copying",
											icon: "link",
											onSelect: () =>
												void act(
													() => window.juno.projects.assets.choose(project.id, "linked"),
													true,
												),
										},
										{
											id: "storage",
											label: "Where the files are kept",
											icon: "projects",
											separatorBefore: true,
											onSelect: () => setStorageOpen(true),
										},
									]}
								/>
							</div>
						}
					>
						Files
					</SectionHeading>

					{assets.length === 0 ? (
						<p className="text-sm text-[var(--ink-muted)]">
							No files yet. Added files are copied into the project's folder. Linked files stay
							where they are, which is what a large export wants.
						</p>
					) : (
						<AssetList
							assets={assets}
							coverAssetId={project.coverAssetId}
							previews
							onOpen={(asset) =>
								void window.juno.projects.assets.open(asset.id).catch((cause: unknown) => {
									setNotice(messageOf(cause));
								})
							}
							onReveal={(asset) =>
								void window.juno.projects.assets.reveal(asset.id).catch((cause: unknown) => {
									setNotice(messageOf(cause));
								})
							}
							onSetCover={(asset) =>
								void act(() => window.juno.projects.setCover(project.id, asset?.id ?? null), true)
							}
							onRemove={(asset) =>
								void act(() => window.juno.projects.assets.remove(asset.id), true)
							}
						/>
					)}
				</section>

				<section>
					<SectionHeading
						action={
							<Button size="dense" data-opens-panel onClick={() => setCommandPanel({ command: null })}>
								<Icon name="add" />
								Add a command
							</Button>
						}
					>
						Commands
					</SectionHeading>

					{commands.length === 0 ? (
						<p className="text-sm text-[var(--ink-muted)]">
							No commands yet. One runs in a real shell with your account, and nothing but this
							screen can write or start one.
						</p>
					) : (
						<ul className="flex flex-col">
							{commands.map((command, index) => {
								const run = runOf(command.id);
								const active = run?.state === "running";
								return (
									<li
										key={command.id}
										className="flex items-center gap-3 border-b border-[var(--line)] px-2"
										style={{ height: "var(--row-height)" }}
									>
										<span className="flex-none text-[var(--ink-faint)]">
											<Icon name={command.kind === "docker" ? "container" : "terminal"} />
										</span>
										<span className="min-w-0 flex-1 truncate text-dense">
											<span className="font-[var(--weight-medium)]">{command.label}</span>
											<span className="ml-2 font-mono text-micro text-[var(--ink-muted)]">
												{command.command}
											</span>
										</span>
										<Button
											size="dense"
											onClick={() => (active ? void stop(command.id) : void start(command))}
										>
											<Icon name={active ? "stop" : "play"} />
											{active ? "Stop" : "Start"}
										</Button>
										<MenuButton
											ariaLabel={`Actions for ${command.label}`}
											items={[
												{
													id: "edit",
													label: "Edit",
													icon: "edit",
													onSelect: () => setCommandPanel({ command }),
												},
												{
													id: "up",
													label: "Move up",
													icon: "move-up",
													disabled: index === 0,
													separatorBefore: true,
													onSelect: () => void act(() => move(commands, index, -1, "commands")),
												},
												{
													id: "down",
													label: "Move down",
													icon: "move-down",
													disabled: index === commands.length - 1,
													onSelect: () => void act(() => move(commands, index, 1, "commands")),
												},
												{
													id: "remove",
													label: "Remove",
													icon: "remove",
													danger: true,
													separatorBefore: true,
													onSelect: () =>
														void act(() => window.juno.projects.commands.remove(command.id), true),
												},
											]}
										/>
									</li>
								);
							})}
						</ul>
					)}
				</section>

					</>
				)}
			</div>

			{linkPanel ? (
				<LinkPanel
					projectId={current.id}
					link={linkPanel.link}
					onClose={() => setLinkPanel(null)}
					onSaved={() => {
						setLinkPanel(null);
						reload(true);
					}}
				/>
			) : null}

			{commandPanel ? (
				<CommandPanel
					projectId={current.id}
					command={commandPanel.command}
					fallbackDir={current.localPath}
					onClose={() => setCommandPanel(null)}
					onSaved={() => {
						setCommandPanel(null);
						reload(true);
					}}
				/>
			) : null}

			{storageOpen ? (
				<StorageDialog
					projectId={current.id}
					onClose={() => setStorageOpen(false)}
					onMoved={() => reload(true)}
				/>
			) : null}

			{linkMailOpen ? (
				<LinkMailDialog
					projectId={current.id}
					projectName={current.name}
					onClose={() => setLinkMailOpen(false)}
					onLinked={() => {
						setLinkMailOpen(false);
						onTabChange("mail");
						reload();
					}}
				/>
			) : null}

			{notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}
		</div>
	);
}

/**
 * Swaps a row with its neighbour and posts the whole order back. The service
 * takes a list rather than a pair, so a reorder is one write and cannot leave
 * two rows holding the same position.
 */
function move<T extends { id: string }>(
	rows: T[],
	index: number,
	direction: -1 | 1,
	kind: "links" | "commands",
): Promise<unknown> {
	const next = [...rows];
	const target = index + direction;
	[next[index], next[target]] = [next[target]!, next[index]!];
	const ids = next.map((row) => row.id);
	const projectId = (rows[0] as unknown as { projectId: string }).projectId;
	return kind === "links"
		? window.juno.projects.links.reorder(projectId, ids)
		: window.juno.projects.commands.reorder(projectId, ids);
}

type DetailProps = {
	label: string;
	value: string;
};

/** One line of the Details column: a small caps label over its value. */
function Detail({ label, value }: DetailProps) {
	return (
		<div>
			<dt className="text-overline uppercase text-[var(--ink-muted)]">{label}</dt>
			<dd data-selectable className="mt-1 text-base">
				{value}
			</dd>
		</div>
	);
}

type SectionHeadingProps = {
	children: string;
	action?: React.ReactNode;
};

function SectionHeading({ children, action }: SectionHeadingProps) {
	return (
		<div className="mb-2 flex items-center justify-between gap-4">
			<h2 className="text-h3">{children}</h2>
			{action}
		</div>
	);
}
