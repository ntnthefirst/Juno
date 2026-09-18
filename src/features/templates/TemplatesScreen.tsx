import { useCallback, useEffect, useState } from "react";
import type { DocumentTemplate, MailTemplate } from "@shared/types";
import { messageOf } from "../../lib/errors";
import { MailTemplateEditor } from "./MailTemplateEditor";
import { TemplateEditor } from "./TemplateEditor";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: DocumentTemplate[] }
	| { status: "error"; message: string };

export function TemplatesScreen() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [mailTemplates, setMailTemplates] = useState<MailTemplate[]>([]);
	const [selectedMailId, setSelectedMailId] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.bureau.mail.templates
			.list()
			.then((rows) => {
				if (!cancelled) setMailTemplates(rows);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const refreshMail = useCallback(() => {
		window.bureau.mail.templates
			.list()
			.then(setMailTemplates)
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		window.bureau.templates
			.list()
			.then((rows) => {
				if (!cancelled) setLoad({ status: "ready", rows });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const refreshList = useCallback(() => {
		window.bureau.templates
			.list()
			.then((rows) => setLoad({ status: "ready", rows }))
			.catch((cause: unknown) => setLoad({ status: "error", message: messageOf(cause) }));
	}, []);

	const split = selectedId !== null || selectedMailId !== null;

	return (
		<div className="flex h-full flex-col p-8">
			<div className={`mb-6 ${split ? "" : "max-w-[900px]"}`}>
				<div className="flex items-baseline gap-3">
					<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
						Templates
					</h1>
					{load.status === "ready" ? (
						<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							{load.rows.length} {load.rows.length === 1 ? "template" : "templates"}
						</span>
					) : null}
				</div>
				<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					The templates that ship are invented. Read one, correct it, and mark it as reviewed
					before you send anything generated from it.
				</p>
			</div>

			<div className="flex min-h-0 flex-1">
				<div
					className={
						split
							? "w-[420px] shrink-0 overflow-y-auto border-r border-[var(--line)] pr-6"
							: "max-w-[900px] flex-1 overflow-y-auto"
					}
				>
					{load.status === "loading" ? (
						<p className="text-[var(--ink-muted)]">Loading.</p>
					) : load.status === "error" ? (
						<div className="border-l-2 border-[var(--risk)] pl-4">
							<p className="font-[var(--weight-medium)] text-[var(--risk)]">
								Could not load your templates.
							</p>
							<p
								data-selectable
								className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]"
							>
								{load.message}
							</p>
						</div>
					) : load.rows.length === 0 ? (
						<p className="text-[var(--ink-muted)]">No templates yet.</p>
					) : (
						<ul>
							{load.rows.map((row) => (
								<TemplateRow
									key={row.id}
									template={row}
									selected={row.id === selectedId}
									onSelect={(id) => {
										setSelectedId(id);
										setSelectedMailId(null);
									}}
								/>
							))}
						</ul>
					)}

					<h2 className="mt-10 border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
						Mail templates
					</h2>
					<p className="mt-3 max-w-[62ch] text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						The subject and body of the emails Bureau composes for you. Dutch, one register each.
					</p>
					{mailTemplates.length === 0 ? (
						<p className="mt-4 text-[var(--ink-muted)]">No mail templates yet.</p>
					) : (
						<ul className="mt-4">
							{mailTemplates.map((row) => (
								<li key={row.id} className="border-b border-[var(--line)]">
									<button
										type="button"
										aria-current={row.id === selectedMailId ? "true" : undefined}
										onClick={() => {
											setSelectedMailId(row.id);
											setSelectedId(null);
										}}
										className={`block w-full rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
											row.id === selectedMailId ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
										}`}
									>
										<span className="flex items-center gap-2">
											<span className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">{row.name}</span>
											<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--sunken)] px-2 py-0.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
												{row.register}
											</span>
										</span>
										<span className="mt-0.5 block truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">{row.subject}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				{selectedId !== null ? (
					<div className="min-w-0 flex-1 overflow-y-auto pl-6">
						<TemplateEditor key={selectedId} templateId={selectedId} onSaved={refreshList} />
					</div>
				) : selectedMailId !== null ? (
					<div className="min-w-0 flex-1 overflow-y-auto pl-6">
						<MailTemplateEditor key={selectedMailId} templateId={selectedMailId} onSaved={refreshMail} />
					</div>
				) : null}
			</div>
		</div>
	);
}

type TemplateRowProps = {
	template: DocumentTemplate;
	selected: boolean;
	onSelect: (id: string) => void;
};

function TemplateRow({ template, selected, onSelect }: TemplateRowProps) {
	const count = template.placeholders.length;
	const reviewed = template.reviewedAt !== null;

	return (
		<li className="border-b border-[var(--line)]">
			<button
				type="button"
				aria-current={selected ? "true" : undefined}
				onClick={() => onSelect(template.id)}
				className={`block w-full rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
					selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
				}`}
			>
				<span className="flex items-center gap-2">
					<span className="truncate text-[length:var(--text-dense)] font-[var(--weight-medium)]">
						{template.name}
					</span>
					{reviewed ? null : (
						<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--risk)]">
							Not reviewed
						</span>
					)}
				</span>
				{template.description ? (
					<span className="mt-0.5 block truncate text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						{template.description}
					</span>
				) : null}
				<span className="tabular mt-0.5 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					Version {template.version}
					{"  ·  "}
					{count} {count === 1 ? "placeholder" : "placeholders"}
				</span>
			</button>
		</li>
	);
}
