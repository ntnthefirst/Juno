import { useState } from "react";
import type { MailTemplate } from "@shared/types";
import { Icon } from "../../../components/Icon";
import { ContextMenu, type MenuItem } from "../../../components/Menu";
import { useContextMenu } from "../../../lib/use-context-menu";

/** What a row's menu, the selection toolbar and a double click all go through. */
export type TemplateAction = "open" | "use" | "edit" | "duplicate" | "hide" | "unhide" | "remove";

type MailTemplateListProps = {
	rows: MailTemplate[];
	searching: boolean;
	openId: string | null;
	selectedIds: string[];
	onOpen: (id: string) => void;
	onToggle: (id: string) => void;
	onAction: (action: TemplateAction, ids: string[]) => void;
};

/**
 * The list of templates, behaving the way the mailbox list does: a search
 * above it, a right-click menu on every row, and rows that stop opening and
 * start ticking the moment anything is selected.
 *
 * That last rule is worth stating because it is the one that surprises people
 * who have not used the mailbox: with a selection running, a plain click is a
 * tick rather than an open, so a list being worked through in bulk cannot
 * throw away the selection by accident.
 */
export function MailTemplateList({
	rows,
	searching,
	openId,
	selectedIds,
	onOpen,
	onToggle,
	onAction,
}: MailTemplateListProps) {
	const menu = useContextMenu();
	const [target, setTarget] = useState<MailTemplate | null>(null);
	const hasSelection = selectedIds.length > 0;

	if (rows.length === 0) {
		return (
			<p className="px-3 py-6 text-[var(--ink-muted)]">
				{searching ? "Nothing matches." : "No mail templates yet."}
			</p>
		);
	}

	function menuItems(template: MailTemplate): MenuItem[] {
		// A right click on a row that is part of a selection acts on the whole
		// selection, which is what every file manager does and what stops a menu
		// from quietly acting on one of fourteen ticked rows.
		const ids = selectedIds.includes(template.id) ? selectedIds : [template.id];
		const many = ids.length > 1;
		return [
			...(many
				? []
				: [
						{ id: "open", label: "Open", icon: "mail" as const, onSelect: () => onAction("open", ids) },
						{ id: "use", label: "Use", icon: "sent" as const, onSelect: () => onAction("use", ids) },
						{ id: "edit", label: "Edit", icon: "edit" as const, onSelect: () => onAction("edit", ids) },
					]),
			{
				id: "duplicate",
				label: many ? `Duplicate ${ids.length}` : "Duplicate",
				icon: "copy",
				separatorBefore: !many,
				onSelect: () => onAction("duplicate", ids),
			},
			template.hiddenAt
				? {
						id: "unhide",
						label: many ? `Show ${ids.length}` : "Show in pickers",
						icon: "read",
						separatorBefore: true,
						onSelect: () => onAction("unhide", ids),
					}
				: {
						id: "hide",
						label: many ? `Hide ${ids.length}` : "Hide from pickers",
						icon: "archive",
						separatorBefore: true,
						onSelect: () => onAction("hide", ids),
					},
			{
				id: "remove",
				// A shipped template cannot be deleted, only hidden, so the menu
				// says so rather than offering a delete that quietly does
				// something else (.claude/rules/data.md section 9).
				label: template.isSystem ? "Hide from pickers" : many ? `Delete ${ids.length}` : "Delete",
				icon: "remove",
				danger: true,
				separatorBefore: true,
				onSelect: () => onAction("remove", ids),
			},
		];
	}

	return (
		<>
			<ul>
				{rows.map((template) => {
					const active = template.id === openId;
					const checked = selectedIds.includes(template.id);
					return (
						<li key={template.id} className="border-b border-[var(--line)]">
							<div
								className={`group flex items-center gap-2 rounded-[var(--radius-md)] px-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
									active ? "bg-[var(--accent-soft)]" : checked ? "bg-[var(--sunken)]" : "hover:bg-[var(--hover)]"
								}`}
								style={{ minHeight: "var(--row-height)" }}
								onContextMenu={(event) => {
									setTarget(template);
									menu.open(event);
								}}
							>
								<input
									type="checkbox"
									checked={checked}
									onChange={() => onToggle(template.id)}
									aria-label={`Select ${template.name}`}
									className={`h-4 w-4 flex-none accent-[var(--accent)] ${
										hasSelection ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
									}`}
								/>
								<button
									type="button"
									aria-current={active ? "true" : undefined}
									onClick={() => (hasSelection ? onToggle(template.id) : onOpen(template.id))}
									onDoubleClick={() => onAction("use", [template.id])}
									className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								>
									<span className="min-w-0 flex-1">
										<span className="flex items-center gap-2">
											<span className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
												{template.name}
											</span>
											{template.layout ? (
												<span
													title="Laid out on the canvas"
													className="flex-none text-[var(--ink-faint)]"
												>
													<Icon name="grid" size={12} />
												</span>
											) : null}
											{template.hiddenAt ? (
												<span className="flex-none rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 py-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
													hidden
												</span>
											) : null}
											{template.isSystem && template.customisedAt === null ? (
												<span className="flex-none rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[length:var(--text-micro)] text-[var(--warn)]">
													unreviewed
												</span>
											) : null}
										</span>
										<span className="mt-0.5 block truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
											{template.subject}
										</span>
									</span>
								</button>
							</div>
						</li>
					);
				})}
			</ul>
			{target && menu.at ? (
				<ContextMenu at={menu.at} items={menuItems(target)} onClose={menu.close} ariaLabel={target.name} />
			) : null}
		</>
	);
}
