import { useCallback, useEffect, useState } from "react";
import type { MailTemplate } from "@shared/types";
import { usePublishBreadcrumb } from "../../app/breadcrumb-context";
import { messageOf } from "../../lib/errors";
import { MailTemplateEditor } from "./MailTemplateEditor";
import { MailTemplatePreview } from "./mail/MailTemplatePreview";
import { UseMailTemplateScreen } from "./UseMailTemplateScreen";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: MailTemplate[] }
	| { status: "error"; message: string };

type View =
	| { mode: "list" }
	| { mode: "preview"; id: string }
	| { mode: "edit"; id: string }
	| { mode: "use"; id: string };

export function MailTemplatesScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [view, setView] = useState<View>({ mode: "list" });

	const fetchRows = useCallback(() => window.juno.mail.templates.list(), []);

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

	const refresh = useCallback(() => {
		fetchRows()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, [fetchRows]);

	const selected = view.mode !== "list" && load.status === "ready"
		? load.rows.find((row) => row.id === view.id) ?? null
		: null;

	usePublishBreadcrumb(
		!selected
			? []
			: view.mode === "preview"
				? [{ label: "Mail templates", onSelect: () => setView({ mode: "list" }) }, { label: selected.name }]
				: [
						{ label: "Mail templates", onSelect: () => setView({ mode: "list" }) },
						{ label: selected.name, onSelect: () => setView({ mode: "preview", id: selected.id }) },
						{ label: view.mode === "edit" ? "Edit" : "Use" },
					],
	);

	// Every non-list view below renders through FormPage, which already binds
	// Escape to its own onBack (guarded the same way, behind a dialog check),
	// and each one is wired to the level directly above it. A second listener
	// here would only ever fire the same transition a second time.

	if (view.mode === "edit" && selected) {
		return (
			<MailTemplateEditor
				key={selected.id}
				templateId={selected.id}
				onBack={() => setView({ mode: "preview", id: selected.id })}
				onSaved={refresh}
			/>
		);
	}

	if (view.mode === "use" && selected) {
		return (
			<UseMailTemplateScreen
				key={selected.id}
				template={selected}
				onBack={() => setView({ mode: "preview", id: selected.id })}
				onCreated={() => setView({ mode: "preview", id: selected.id })}
			/>
		);
	}

	if (view.mode === "preview" && selected) {
		return (
			<MailTemplatePreview
				key={selected.id}
				template={selected}
				onBack={() => setView({ mode: "list" })}
				onEdit={() => setView({ mode: "edit", id: selected.id })}
				onUse={() => setView({ mode: "use", id: selected.id })}
			/>
		);
	}

	return (
		<div className="flex h-full flex-col p-8">
			<div className="mx-auto mb-6 w-full max-w-[var(--content-width)]">
				<div className="flex items-baseline gap-3">
					<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
						Mail templates
					</h1>
					{load.status === "ready" ? (
						<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{load.rows.length} {load.rows.length === 1 ? "template" : "templates"}
						</span>
					) : null}
				</div>
				<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					The subject and body of the emails Juno composes for you. The texts that ship are
					invented, so read one, correct it, and mark it as reviewed before Juno sends anything
					drafted from it.
				</p>
			</div>

			<div className="mx-auto w-full max-w-[var(--content-width)] flex-1 overflow-y-auto">
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
				) : load.rows.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No mail templates yet.</p>
				) : (
					<ul>
						{load.rows.map((row) => (
							<MailTemplateRow
								key={row.id}
								template={row}
								selected={false}
								onSelect={(id) => setView({ mode: "preview", id })}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

type MailTemplateRowProps = {
	template: MailTemplate;
	selected: boolean;
	onSelect: (id: string) => void;
};

function MailTemplateRow({ template, selected, onSelect }: MailTemplateRowProps) {
	return (
		<li className="border-b border-[var(--line)]">
			<button
				type="button"
				aria-current={selected ? "true" : undefined}
				onClick={() => onSelect(template.id)}
				style={{ minHeight: "var(--row-height)" }}
				className={`block w-full rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
					selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
				}`}
			>
				<span className="flex items-center gap-2">
					<span className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
						{template.name}
					</span>
					<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
						{template.register}
					</span>
				</span>
				<span className="mt-0.5 block truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					{template.subject}
				</span>
			</button>
		</li>
	);
}
