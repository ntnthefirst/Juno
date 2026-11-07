import { useCallback, useEffect, useState } from "react";
import type { DocumentComponent } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconAction } from "../../components/IconAction";
import { InlineAdd } from "../../components/InlineAdd";
import { messageOf } from "../../lib/errors";

type Load =
	| { status: "loading" }
	| { status: "ready"; rows: DocumentComponent[] }
	| { status: "error"; message: string };

type ComponentsScreenProps = {
	onOpen: (id: string) => void;
	/** Back to the list of templates. */
	onBack: () => void;
};

/**
 * The components for document templates: pieces of a page made once and
 * placed in many templates (decision 65). It sits one step in from the
 * Templates screen, which is where a template is made, and follows its list:
 * a name and what it asks for, the new button at the right.
 */
export function ComponentsScreen({ onOpen, onBack }: ComponentsScreenProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<DocumentComponent | null>(null);

	const fetchRows = useCallback(() => window.juno.templates.components.list(), []);

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

	async function create(name: string): Promise<void> {
		setError(null);
		setCreating(true);
		try {
			const made = await window.juno.templates.components.create({ name });
			onOpen(made.id);
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setCreating(false);
		}
	}

	/** Refused while a template places it. The service says which, and that is shown as it is. */
	async function remove(component: DocumentComponent): Promise<void> {
		setError(null);
		try {
			await window.juno.templates.components.remove(component.id);
			setLoad({ status: "ready", rows: await fetchRows() });
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	const rows = load.status === "ready" ? load.rows : [];

	return (
		<div className="flex h-full flex-col p-8">
			<div className="mb-6 w-full">
				<div className="flex items-center gap-3">
					<Button size="dense" onClick={onBack}>
						Templates
					</Button>
					<h2 className="text-h3">Components</h2>
					{load.status === "ready" ? (
						<span className="text-sm text-[var(--ink-muted)]">
							{rows.length} {rows.length === 1 ? "component" : "components"}
						</span>
					) : null}
					<span className="ml-auto" />
					<InlineAdd
						label="New component"
						placeholder="Component name"
						busy={creating}
						onSubmit={(name) => void create(name)}
					/>
				</div>
				<p className="mt-3 max-w-[62ch] text-sm text-[var(--ink-muted)]">
					A letterhead, a signature block or a price table, made once and placed in as many templates as you like.
					Changing a component changes every template that places it, and those templates need reviewing again.
				</p>
				{error ? (
					<p role="alert" data-selectable className="mt-3 border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
						{error}
					</p>
				) : null}
			</div>

			<div className="w-full flex-1 overflow-y-auto">
				{load.status === "loading" ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : load.status === "error" ? (
					<div className="border-l-2 border-[var(--risk)] pl-4">
						<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load your components.</p>
						<p data-selectable className="mt-1 text-sm text-[var(--ink-muted)]">
							{load.message}
						</p>
					</div>
				) : rows.length === 0 ? (
					<p className="text-[var(--ink-muted)]">No components yet.</p>
				) : (
					<ul>
						{rows.map((row) => (
							<li key={row.id} className="border-b border-[var(--line)]">
								<div
									className="group flex items-center gap-2 rounded-[var(--radius-md)] px-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
									style={{ minHeight: "var(--row-height)" }}
								>
									<button
										type="button"
										onClick={() => onOpen(row.id)}
										className="min-w-0 flex-1 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
									>
										<span className="block truncate text-dense font-[var(--weight-medium)]">{row.name}</span>
										{row.description ? (
											<span className="mt-0.5 block truncate text-dense text-[var(--ink-muted)]">{row.description}</span>
										) : null}
										<span className="tabular mt-0.5 block text-sm text-[var(--ink-muted)]">
											{row.inputs.length} {row.inputs.length === 1 ? "input" : "inputs"}
											{"  ·  "}
											{row.usedBy === 0
												? "Not placed anywhere"
												: `Placed in ${row.usedBy} ${row.usedBy === 1 ? "template" : "templates"}`}
										</span>
									</button>
									<IconAction icon="remove" label={`Delete ${row.name}`} danger onClick={() => setConfirm(row)} />
								</div>
							</li>
						))}
					</ul>
				)}
			</div>

			{confirm ? (
				<Dialog title="Delete component" onClose={() => setConfirm(null)} width="narrow">
					<p className="text-dense">
						{confirm.usedBy > 0
							? `${confirm.name} is placed in ${confirm.usedBy} ${confirm.usedBy === 1 ? "template" : "templates"}, so it cannot be deleted. Take it off those pages or detach it there first.`
							: `${confirm.name} will be deleted. This cannot be undone.`}
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setConfirm(null)}>{confirm.usedBy > 0 ? "Close" : "Cancel"}</Button>
						{confirm.usedBy > 0 ? null : (
							<Button
								variant="danger"
								onClick={() => {
									const target = confirm;
									setConfirm(null);
									void remove(target);
								}}
							>
								Delete
							</Button>
						)}
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
