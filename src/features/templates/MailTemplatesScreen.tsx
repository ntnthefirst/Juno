import { useCallback, useEffect, useMemo, useState } from "react";
import type { MailTemplate } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { AddButton } from "../../components/AddButton";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { MailTemplateEditor } from "./MailTemplateEditor";
import { MailTemplateList, type TemplateAction } from "./mail/MailTemplateList";
import { MailTemplatePanel } from "./mail/MailTemplatePanel";
import { UseMailTemplateScreen } from "./UseMailTemplateScreen";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: MailTemplate[] }
	| { status: "error"; message: string };

type View = { mode: "list" } | { mode: "edit"; id: string } | { mode: "use"; id: string };

/** What a delete is about to do, held while the question is on screen. */
type Confirm = { ids: string[]; deleting: MailTemplate[]; hiding: MailTemplate[] };

function matches(template: MailTemplate, needle: string): boolean {
	const haystack = [template.name, template.subject, template.description ?? "", template.key]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

/**
 * The mail templates screen: a list with a search over it, a panel on the
 * right for the one being read, and the editor and the use flow as pages that
 * replace it.
 *
 * `listAll` rather than `list`, because a hidden template has to be reachable
 * to be put back. The pickers elsewhere call `list` and never see one
 * (.claude/rules/data.md section 9).
 */
export function MailTemplatesScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [view, setView] = useState<View>({ mode: "list" });
	const [search, setSearch] = useState("");
	const [openId, setOpenId] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [confirm, setConfirm] = useState<Confirm | null>(null);
	const [error, setError] = useState<string | null>(null);

	const fetchRows = useCallback(() => window.juno.mail.templates.listAll(), []);

	const refresh = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [fetchRows]);

	useEffect(() => {
		let cancelled = false;
		fetchRows()
			.then((rows) => {
				if (!cancelled) setLoad({ status: "ready", rows });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchRows]);

	// Memoised because it is a dependency of the filter below and of byId: a
	// fresh [] on every render would rebuild both on every keystroke.
	const rows = useMemo(() => (load.status === "ready" ? load.rows : []), [load]);
	const needle = search.trim().toLowerCase();
	const shown = useMemo(
		() => (needle ? rows.filter((row) => matches(row, needle)) : rows),
		[rows, needle],
	);

	const byId = useCallback((id: string) => rows.find((row) => row.id === id) ?? null, [rows]);
	const opened = openId ? byId(openId) : null;
	const editing = view.mode === "edit" ? byId(view.id) : null;
	const using = view.mode === "use" ? byId(view.id) : null;
	const selectedRow = editing ?? using;

	usePublishBreadcrumb(
		!selectedRow
			? []
			: [
					{ label: "Mail templates", onSelect: () => setView({ mode: "list" }) },
					{ label: selectedRow.name },
					{ label: view.mode === "edit" ? "Edit" : "Use" },
				],
	);

	async function run(action: TemplateAction, ids: string[]): Promise<void> {
		setError(null);
		try {
			const templates = window.juno.mail.templates;
			switch (action) {
				case "open":
					setOpenId(ids[0] ?? null);
					return;
				case "use":
					if (ids[0]) setView({ mode: "use", id: ids[0] });
					return;
				case "edit":
					if (ids[0]) setView({ mode: "edit", id: ids[0] });
					return;
				case "duplicate":
					for (const id of ids) await templates.duplicate(id);
					break;
				case "hide":
					for (const id of ids) await templates.hide(id);
					break;
				case "unhide":
					for (const id of ids) await templates.unhide(id);
					break;
				case "remove":
					for (const id of ids) await templates.remove(id);
					if (openId && ids.includes(openId)) setOpenId(null);
					break;
			}
			setSelectedIds([]);
			refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	function onAction(action: TemplateAction, ids: string[]): void {
		// A delete asks first and says what it will do to each kind, because a
		// shipped template is hidden rather than deleted and the count alone
		// would not say which of the two is about to happen.
		if (action === "remove") {
			const targets = ids.map(byId).filter((row): row is MailTemplate => row !== null);
			setConfirm({
				ids,
				deleting: targets.filter((row) => !row.isSystem),
				hiding: targets.filter((row) => row.isSystem),
			});
			return;
		}
		void run(action, ids);
	}

	async function create(): Promise<void> {
		setError(null);
		try {
			const created = await window.juno.mail.templates.create({
				name: "New template",
				subject: "",
				bodyHtml: "<p></p>",
			});
			refresh();
			setView({ mode: "edit", id: created.id });
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	if (view.mode === "edit" && editing) {
		return (
			<MailTemplateEditor
				key={editing.id}
				templateId={editing.id}
				onBack={() => setView({ mode: "list" })}
				onSaved={refresh}
			/>
		);
	}

	if (view.mode === "use" && using) {
		return (
			<UseMailTemplateScreen
				key={using.id}
				template={using}
				onBack={() => setView({ mode: "list" })}
				onCreated={() => setView({ mode: "list" })}
			/>
		);
	}

	return (
		<div className="relative flex h-full flex-col">
			<div className="flex-none px-8 pt-8">
				<div className="mx-auto w-full max-w-[var(--content-width)]">
					<div className="flex items-center gap-3">
						<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
							Mail templates
						</h1>
						{load.status === "ready" ? (
							<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{shown.length} {shown.length === 1 ? "template" : "templates"}
							</span>
						) : null}
						<span className="ml-auto" />
						<AddButton label="New mail template" onClick={() => void create()} />
					</div>
					<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						The subject and body of the emails Juno composes for you. The texts that ship are
						invented, so read one, correct it, and mark it as reviewed before Juno sends anything
						drafted from it.
					</p>

					<div className="mt-5 flex items-center gap-2">
						<div className="flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] pr-1 pl-2 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]">
							<Icon name="search" size={14} />
							<input
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search templates"
								aria-label="Search templates"
								className="min-w-0 flex-1 bg-transparent py-1.5 text-[length:var(--text-dense)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
							/>
						</div>
						{selectedIds.length > 0 ? (
							<>
								<span className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
									{selectedIds.length} selected
								</span>
								<Button size="dense" onClick={() => onAction("duplicate", selectedIds)}>
									Duplicate
								</Button>
								<Button size="dense" onClick={() => onAction("hide", selectedIds)}>
									Hide
								</Button>
								<Button size="dense" variant="danger" onClick={() => onAction("remove", selectedIds)}>
									Delete
								</Button>
								<Button size="dense" onClick={() => setSelectedIds([])}>
									Clear
								</Button>
							</>
						) : null}
					</div>

					{error ? (
						<p
							role="alert"
							data-selectable
							className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
						>
							{error}
						</p>
					) : null}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
				<div className="mx-auto mt-4 w-full max-w-[var(--content-width)]">
					{load.status === "loading" ? (
						<p className="text-[var(--ink-muted)]">Loading.</p>
					) : load.status === "error" ? (
						<div className="border-l-2 border-[var(--risk)] pl-4">
							<p className="font-[var(--weight-medium)] text-[var(--risk)]">
								Could not load your mail templates.
							</p>
							<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{load.message}
							</p>
						</div>
					) : (
						<MailTemplateList
							rows={shown}
							searching={needle.length > 0}
							openId={openId}
							selectedIds={selectedIds}
							onOpen={setOpenId}
							onToggle={(id) =>
								setSelectedIds((current) =>
									current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
								)
							}
							onAction={onAction}
						/>
					)}
				</div>
			</div>

			{opened ? (
				<MailTemplatePanel
					key={opened.id}
					template={opened}
					onClose={() => setOpenId(null)}
					onEdit={() => setView({ mode: "edit", id: opened.id })}
					onUse={() => setView({ mode: "use", id: opened.id })}
				/>
			) : null}

			{confirm ? (
				<Dialog title="Delete templates" onClose={() => setConfirm(null)} width="narrow">
					<p className="text-[length:var(--text-dense)]">
						{confirm.deleting.length > 0
							? `${confirm.deleting.length} ${confirm.deleting.length === 1 ? "template" : "templates"} will be deleted.`
							: null}
					</p>
					{confirm.hiding.length > 0 ? (
						<p className="mt-2 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
							{confirm.hiding.length} shipped {confirm.hiding.length === 1 ? "template" : "templates"} will
							be hidden instead of deleted. Drafts already using {confirm.hiding.length === 1 ? "it" : "them"}{" "}
							keep working.
						</p>
					) : null}
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirm(null)}>Cancel</Button>
						<Button
							variant="danger"
							onClick={() => {
								const ids = confirm.ids;
								setConfirm(null);
								void run("remove", ids);
							}}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
