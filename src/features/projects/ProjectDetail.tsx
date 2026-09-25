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
} from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { MarkdownNotes } from "../../components/MarkdownNotes";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { StatusBadge } from "../../components/StatusBadge";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { AssetList } from "./AssetList";
import { CommandPanel } from "./CommandPanel";
import { formatCents, formatDate, LINK_ICONS, pathTail } from "./format";
import { LinkPanel } from "./LinkPanel";
import { RunConsole } from "./RunConsole";
import { StorageDialog } from "./StorageDialog";

type ProjectDetailProps = {
	projectId: string;
	onBack: () => void;
	/** The list behind this has to read again: a name, a status or a cover changed. */
	onChanged: () => void;
	onEdit: (project: Project) => void;
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
};

type Load = { status: "loading" } | { status: "ready"; data: Loaded } | { status: "error"; message: string };

/**
 * One project: what it is, where it lives, what is attached to it, and what
 * starts it.
 *
 * It takes the whole working area rather than sitting beside the list, which is
 * what the September rework settled for every record in Juno. The trail in the
 * title bar is what says where you are and how to get back.
 */
export function ProjectDetail({
	projectId,
	onBack,
	onChanged,
	onEdit,
	onNameChange,
	onDeleted,
}: ProjectDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [runs, setRuns] = useState<ProjectRun[]>([]);
	const [linkPanel, setLinkPanel] = useState<{ link: ProjectLink | null } | null>(null);
	const [commandPanel, setCommandPanel] = useState<{ command: ProjectCommand | null } | null>(null);
	const [storageOpen, setStorageOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const fetchAll = useCallback(async (): Promise<Loaded> => {
		const project = await window.juno.projects.get(projectId);
		if (!project) throw new Error("That project no longer exists.");

		const [client, statusSet, links, assets, commands] = await Promise.all([
			project.clientId ? window.juno.clients.get(project.clientId) : Promise.resolve(null),
			window.juno.reference.getSet("project_status"),
			window.juno.projects.links.list(projectId),
			window.juno.projects.assets.list(projectId),
			window.juno.projects.commands.list(projectId),
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
		};
	}, [projectId]);

	const reload = useCallback(
		(alsoList = false) => {
			fetchAll()
				.then((data) => {
					setLoad({ status: "ready", data });
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

	if (load.status === "loading") {
		return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (load.status === "error") {
		return (
			<div className="p-8">
				<div className="border-l-2 border-[var(--risk)] pl-4">
					<p className="font-[var(--weight-medium)] text-[var(--risk)]">
						Could not open this project.
					</p>
					<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{load.message}
					</p>
				</div>
				<div className="mt-6">
					<Button onClick={onBack}>Back to projects</Button>
				</div>
			</div>
		);
	}

	const { project, client, status, links, assets, commands } = load.data;
	const firstCommand = commands[0] ?? null;
	const runOf = (commandId: string) => runs.find((one) => one.commandId === commandId) ?? null;
	const firstRun = firstCommand ? runOf(firstCommand.id) : null;
	const running = firstRun?.state === "running";

	const moreActions: MenuItem[] = [
		{
			id: "storage",
			label: "Where the files are kept",
			icon: "projects",
			onSelect: () => setStorageOpen(true),
		},
		{
			id: "local",
			label: "Open the project folder",
			icon: "folder-open",
			disabled: !project.localPath,
			onSelect: () =>
				void window.juno.projects.openLocalFolder(project.id).catch((cause: unknown) => {
					setNotice(messageOf(cause));
				}),
		},
		{
			id: "edit",
			label: "Edit",
			icon: "edit",
			separatorBefore: true,
			onSelect: () => onEdit(project),
		},
		{
			id: "delete",
			label: "Delete",
			icon: "remove",
			danger: true,
			separatorBefore: true,
			onSelect: () =>
				void window.juno.projects
					.remove(project.id)
					.then(() =>
						onDeleted({
							id: project.id,
							clientId: project.clientId,
							clientName: client?.name ?? null,
							name: project.name,
							status,
							dueOn: project.dueOn,
							agreedValueCents: project.agreedValueCents,
							description: project.description,
							localPath: project.localPath,
							updatedAt: project.updatedAt,
							coverAssetId: project.coverAssetId,
							linkKinds: [],
							assetCount: assets.length,
							commandCount: commands.length,
						}),
					)
					.catch((cause: unknown) => setNotice(messageOf(cause))),
		},
	];

	return (
		<div className="relative h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-[var(--content-width)] p-8">
				<header className="flex items-start gap-4">
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-3">
							<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
								{project.name}
							</h1>
							{status ? <StatusBadge label={status.label} tone={status.tone} /> : null}
						</div>
						<p className="mt-1 text-[var(--ink-muted)]">
							{client ? client.name : "Your own work"}
							{project.dueOn ? ` / due ${formatDate(project.dueOn)}` : ""}
							{project.agreedValueCents !== null
								? ` / ${formatCents(project.agreedValueCents)}`
								: ""}
						</p>
					</div>

					<div className="flex flex-none items-center gap-2">
						{firstCommand ? (
							<>
								<Button
									variant="primary"
									onClick={() => (running ? void stop(firstCommand.id) : void start(firstCommand))}
								>
									<Icon name={running ? "stop" : "play"} />
									{running ? "Stop" : "Start"}
								</Button>
								{commands.length > 1 ? (
									// A chevron rather than three dots: it belongs to the Start
									// button beside it, and a second set of dots next to the
									// record's own menu reads as two of the same control.
									<MenuButton
										size="base"
										icon="chevron-down"
										ariaLabel="Other commands"
										items={commands.slice(1).map((command) => ({
											id: command.id,
											label:
												runOf(command.id)?.state === "running"
													? `Stop ${command.label}`
													: `Start ${command.label}`,
											icon: command.kind === "docker" ? "container" : "terminal",
											onSelect: () =>
												runOf(command.id)?.state === "running"
													? void stop(command.id)
													: void start(command),
										}))}
									/>
								) : null}
							</>
						) : null}
						<Button onClick={() => onEdit(project)}>
							<Icon name="edit" />
							Edit
						</Button>
						<MenuButton size="base" ariaLabel="More project actions" items={moreActions} />
					</div>
				</header>

				{project.localPath ? (
					<p className="mt-4 flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						<Icon name="projects" size={14} />
						<span data-selectable className="truncate font-mono" title={project.localPath}>
							{project.localPath}
						</span>
					</p>
				) : null}

				{runs.length > 0 ? (
					<div className="mt-6 flex flex-col gap-3">
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

				{project.description ? (
					<section className="mt-8">
						<SectionHeading>About</SectionHeading>
						<MarkdownNotes text={project.description} />
					</section>
				) : null}

				<section className="mt-8">
					<SectionHeading
						action={
							<Button size="dense" onClick={() => setLinkPanel({ link: null })}>
								<Icon name="add" />
								Add a link
							</Button>
						}
					>
						Links
					</SectionHeading>

					{links.length === 0 ? (
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
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
										className="min-w-0 flex-1 truncate text-left text-[length:var(--text-dense)]"
										title={link.target}
									>
										{link.label}
									</button>
									<span className="hidden min-w-0 max-w-[40%] flex-none truncate text-[length:var(--text-micro)] text-[var(--ink-muted)] sm:block">
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

				<section className="mt-8">
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
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
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

				<section className="mt-8 mb-4">
					<SectionHeading
						action={
							<Button size="dense" onClick={() => setCommandPanel({ command: null })}>
								<Icon name="add" />
								Add a command
							</Button>
						}
					>
						Commands
					</SectionHeading>

					{commands.length === 0 ? (
						<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
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
										<span className="min-w-0 flex-1 truncate text-[length:var(--text-dense)]">
											<span className="font-[var(--weight-medium)]">{command.label}</span>
											<span className="ml-2 font-mono text-[length:var(--text-micro)] text-[var(--ink-muted)]">
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
			</div>

			{linkPanel ? (
				<LinkPanel
					projectId={project.id}
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
					projectId={project.id}
					command={commandPanel.command}
					fallbackDir={project.localPath}
					onClose={() => setCommandPanel(null)}
					onSaved={() => {
						setCommandPanel(null);
						reload(true);
					}}
				/>
			) : null}

			{storageOpen ? (
				<StorageDialog
					projectId={project.id}
					onClose={() => setStorageOpen(false)}
					onMoved={() => reload(true)}
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

type SectionHeadingProps = {
	children: string;
	action?: React.ReactNode;
};

function SectionHeading({ children, action }: SectionHeadingProps) {
	return (
		<div className="mb-2 flex items-center justify-between gap-4">
			<h2 className="text-[length:var(--text-h3)] font-[var(--weight-semibold)]">{children}</h2>
			{action}
		</div>
	);
}
