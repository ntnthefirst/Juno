import { useEffect, useMemo, useRef, useState } from "react";
import type { MailTemplate } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { LoadPicturesNotice } from "../../components/LoadPicturesNotice";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { framed } from "../../lib/framed-preview";
import { requestOpen } from "../../lib/open-entity";
import { useRemotePictures } from "../../lib/remote-pictures";
import { useContextMenu } from "../../lib/use-context-menu";
import { useCanvasFonts } from "../templates/mail/canvas/use-canvas-fonts";
import { UseMailTemplateScreen } from "../templates/UseMailTemplateScreen";

type StyledMailPaneProps = {
	onClose: () => void;
	/** A message was queued from a template. */
	onSent: () => void;
};

type Rendered = { templateId: string; subject: string; html: string } | { templateId: string; error: string };

const ICON_BUTTON =
	"flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)]";

/**
 * Styled mail beside the mailbox, as a column on the right rather than a
 * screen of its own: the templates as a list, the one picked shown below as it
 * will read, and the steps to send it in the same column once it is chosen.
 *
 * A click picks a template and shows it. A double click, Enter or Use starts
 * sending it, and the steps (who it goes to, what it asks for, how it reads)
 * replace the list in the column, so the mailbox stays in view the whole time.
 * The column widens to show a message at the width a reader sees it, and
 * narrows back again. Writing and changing templates is still the styled mail
 * screen, one press away.
 */
export function StyledMailPane({ onClose, onSent }: StyledMailPaneProps) {
	const [templates, setTemplates] = useState<MailTemplate[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [usingId, setUsingId] = useState<string | null>(null);
	const [wide, setWide] = useState(false);
	const [rendered, setRendered] = useState<Rendered | null>(null);
	const [menuTarget, setMenuTarget] = useState<MailTemplate | null>(null);
	const menu = useContextMenu();
	const rows = useRef(new Map<string, HTMLButtonElement>());

	useEffect(() => {
		let cancelled = false;
		window.juno.mail.templates
			.list()
			.then((list) => {
				if (cancelled) return;
				setTemplates(list);
				setSelectedId((current) => current ?? list[0]?.id ?? null);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoadError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Escape steps back out of sending first, then closes the column.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || document.querySelector("[role='dialog'], [role='menu']")) return;
			if (usingId) setUsingId(null);
			else onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [usingId, onClose]);

	const needle = search.trim().toLowerCase();
	const shown = useMemo(
		() =>
			(templates ?? []).filter((template) =>
				needle
					? [template.name, template.subject, template.description ?? ""].join(" ").toLowerCase().includes(needle)
					: true,
			),
		[templates, needle],
	);
	const selected = templates?.find((template) => template.id === selectedId) ?? null;
	const using = templates?.find((template) => template.id === usingId) ?? null;

	// Rendered with nothing typed, so every input shows its [ontbreekt: ...]
	// marker and it is plain which parts change each time.
	useEffect(() => {
		if (!selectedId) return;
		let cancelled = false;
		window.juno.mail.templates
			.render({ templateId: selectedId })
			.then((result) => {
				if (!cancelled) setRendered({ templateId: selectedId, subject: result.subject, html: result.bodyHtml });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setRendered({ templateId: selectedId, error: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [selectedId]);

	const current = rendered && rendered.templateId === selectedId ? rendered : null;
	const fonts = useCanvasFonts(selected?.layout?.fonts ?? []);
	const remote = useRemotePictures(current && "html" in current ? current.html : "");

	function onListKey(event: React.KeyboardEvent) {
		if (shown.length === 0) return;
		const index = shown.findIndex((template) => template.id === selectedId);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const next = shown[Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), shown.length - 1)];
			if (next) {
				setSelectedId(next.id);
				rows.current.get(next.id)?.focus();
			}
		}
		if (event.key === "Enter" && selectedId) {
			event.preventDefault();
			setUsingId(selectedId);
		}
	}

	function menuItems(template: MailTemplate): MenuItem[] {
		return [
			{ id: "use", label: "Use", icon: "mail", hint: "Double click", onSelect: () => setUsingId(template.id) },
			{
				id: "show",
				label: wide && selectedId === template.id ? "Show narrow" : "Show full size",
				icon: wide && selectedId === template.id ? "collapse" : "expand",
				onSelect: () => {
					setSelectedId(template.id);
					setWide((value) => !(value && selectedId === template.id));
				},
			},
			{
				id: "open",
				label: "Open in Styled mail",
				icon: "external",
				separatorBefore: true,
				onSelect: () => requestOpen({ kind: "mail-template", id: template.id, mode: "view" }),
			},
			{
				id: "edit",
				label: "Edit",
				icon: "edit",
				onSelect: () => requestOpen({ kind: "mail-template", id: template.id, mode: "edit" }),
			},
		];
	}

	return (
		<aside
			aria-label="Styled mail"
			className="animate-slide flex h-full min-h-0 flex-none flex-col border-l border-[var(--line)] bg-[var(--paper)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-smooth)]"
			style={{ width: wide ? "min(760px, 62%)" : "360px" }}
		>
			{using ? (
				<UseMailTemplateScreen
					key={using.id}
					template={using}
					variant="panel"
					onBack={() => setUsingId(null)}
					onCreated={() => {
						setUsingId(null);
						onSent();
					}}
				/>
			) : (
				<>
					<div className="flex flex-none items-center gap-1 px-4 pt-3 pb-2">
						<h2 className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-[var(--weight-semibold)]">
							Styled mail
						</h2>
						<button
							type="button"
							onClick={() => setWide((value) => !value)}
							aria-label={wide ? "Show narrow" : "Show full size"}
							title={wide ? "Show narrow" : "Show full size"}
							aria-pressed={wide}
							className={ICON_BUTTON}
						>
							<Icon name={wide ? "collapse" : "expand"} size={16} />
						</button>
						<button type="button" onClick={onClose} aria-label="Close" title="Close" className={ICON_BUTTON}>
							<Icon name="close" size={16} />
						</button>
					</div>

					<div className="flex-none px-4 pb-2">
						<label className="flex h-8 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-2.5 focus-within:border-[var(--accent)]">
							<Icon name="search" size={14} className="flex-none text-[var(--ink-muted)]" />
							<input
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Find a template"
								aria-label="Find a template"
								className="min-w-0 flex-1 bg-transparent text-[length:var(--text-dense)] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
							/>
						</label>
					</div>

					<ul
						aria-label="Templates"
						onKeyDown={onListKey}
						className="max-h-[38%] flex-none overflow-y-auto border-b border-[var(--line)] px-2 pb-2"
					>
						{loadError ? (
							<li role="alert" data-selectable className="px-2 py-2 text-[length:var(--text-sm)] text-[var(--risk)]">
								{loadError}
							</li>
						) : templates === null ? (
							<li className="px-2 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Loading.</li>
						) : shown.length === 0 ? (
							<li className="px-2 py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{needle ? "Nothing matches." : "No styled mail yet. Make one in Styled mail."}
							</li>
						) : (
							shown.map((template) => {
								const active = template.id === selectedId;
								return (
									<li key={template.id}>
										<button
											type="button"
											ref={(element) => {
												if (element) rows.current.set(template.id, element);
												else rows.current.delete(template.id);
											}}
											onClick={() => setSelectedId(template.id)}
											onDoubleClick={() => setUsingId(template.id)}
											onContextMenu={(event) => {
												setMenuTarget(template);
												menu.open(event);
											}}
											aria-current={active ? "true" : undefined}
											title="Double click to use"
											className={[
												"flex w-full flex-col rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
												active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
											].join(" ")}
										>
											<span
												className={`truncate text-[length:var(--text-dense)] font-[var(--weight-medium)] ${active ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}
											>
												{template.name}
											</span>
											<span className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
												{template.description || template.subject}
											</span>
										</button>
									</li>
								);
							})
						)}
					</ul>

					<div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-3">
						{selected ? (
							<>
								<div className="flex flex-none items-start gap-2">
									<div className="min-w-0 flex-1">
										<p className="truncate text-[length:var(--text-dense)] font-[var(--weight-semibold)]">{selected.name}</p>
										<p className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
											{current && "subject" in current ? current.subject : selected.subject}
										</p>
									</div>
									<Button size="dense" variant="primary" onClick={() => setUsingId(selected.id)}>
										Use
									</Button>
								</div>
								<div className="mt-2 flex-none">
									<LoadPicturesNotice pending={remote.pending} onConfirm={remote.confirm} />
								</div>
								{current && "error" in current ? (
									<p role="alert" data-selectable className="mt-2 text-[length:var(--text-sm)] text-[var(--risk)]">
										{current.error}
									</p>
								) : current ? (
									<div className="mt-1 min-h-0 flex-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)]">
										<iframe
											title={`Preview of ${selected.name}`}
											srcDoc={framed(current.html, fonts.css, remote.pictures)}
											sandbox=""
											referrerPolicy="no-referrer"
											className="block h-full w-full bg-[var(--surface)]"
										/>
									</div>
								) : (
									<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">Rendering.</p>
								)}
							</>
						) : (
							<p className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">Pick a template to see it here.</p>
						)}
					</div>

					<div className="flex flex-none items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-2">
						<span className="text-[length:var(--text-micro)] text-[var(--ink-muted)]">Double click a template to use it.</span>
						<Button size="dense" onClick={() => requestOpen({ kind: "screen", screen: "mail-templates" })}>
							Manage
						</Button>
					</div>
				</>
			)}

			{menu.at && menuTarget ? (
				<ContextMenu at={menu.at} items={menuItems(menuTarget)} onClose={menu.close} ariaLabel={`Actions for ${menuTarget.name}`} />
			) : null}
		</aside>
	);
}
