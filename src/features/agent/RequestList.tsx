import { useState } from "react";
import type { AgentAction } from "@shared/types";
import { Button } from "../../components/Button";
import { ContextMenu, type MenuItem } from "../../components/Menu";
import { messageOf } from "../../lib/errors";
import { useContextMenu } from "../../lib/use-context-menu";
import { ACTION_LABELS, ACTION_TONES, formatArgs, formatWhen } from "./format";

type RequestListProps = {
	actions: AgentAction[] | null;
	error: string | null;
	onChanged: () => void;
	onNotice: (message: string) => void;
};

/**
 * What an agent asked for, and the two buttons that are the whole point of
 * the phase: nothing here has happened yet.
 */
export function RequestList({ actions, error, onChanged, onNotice }: RequestListProps) {
	if (error) {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load the requests.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{error}
				</p>
			</div>
		);
	}
	if (actions === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;

	const pending = actions.filter((action) => action.state === "pending");
	const answered = actions.filter((action) => action.state !== "pending");

	return (
		<div className="mx-auto w-full max-w-[var(--content-width)]">
			<section>
				<div className="flex items-baseline gap-3 border-b border-[var(--line)] pb-2">
					<h2 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Waiting for you</h2>
					<span className="tabular text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						{pending.length}
					</span>
				</div>
				{pending.length === 0 ? (
					<p className="mt-4 text-[var(--ink-muted)]">
						Nothing is waiting. An agent that asks for something that changes a record will appear
						here, and nothing happens until you approve it.
					</p>
				) : (
					<div className="mt-4 flex flex-col gap-3">
						{pending.map((action) => (
							<RequestCard key={action.id} action={action} onChanged={onChanged} onNotice={onNotice} />
						))}
					</div>
				)}
			</section>

			{answered.length > 0 ? (
				<section className="mt-10">
					<h2 className="border-b border-[var(--line)] pb-2 text-[length:var(--text-h3)] font-[var(--weight-medium)]">
						Answered
					</h2>
					<div className="mt-4">
						{answered.map((action) => (
							<AnsweredRow key={action.id} action={action} onChanged={onChanged} onNotice={onNotice} />
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}

type CardProps = {
	action: AgentAction;
	onChanged: () => void;
	onNotice: (message: string) => void;
};

/** A pending request floats above the page while it waits, so it earns a surface. */
function RequestCard({ action, onChanged, onNotice }: CardProps) {
	const [busy, setBusy] = useState(false);
	const menu = useContextMenu();

	async function answer(approve: boolean) {
		if (busy) return;
		setBusy(true);
		try {
			if (approve) await window.juno.agent.actions.approve(action.id);
			else await window.juno.agent.actions.reject(action.id);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
			onChanged();
		} finally {
			setBusy(false);
		}
	}

	const items: MenuItem[] = [
		{ id: "approve", label: "Approve", icon: "check", disabled: busy, onSelect: () => void answer(true) },
		{ id: "reject", label: "Reject", icon: "close", disabled: busy, onSelect: () => void answer(false) },
	];

	return (
		<div
			onContextMenu={menu.open}
			className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4"
		>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<p className="font-[var(--weight-medium)]">{action.summary}</p>
					<p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						<span className="font-mono">{action.toolName}</span>
						{" · asked "}
						<span className="tabular">{formatWhen(action.createdAt)}</span>
						{" · expires "}
						<span className="tabular">{formatWhen(action.expiresAt)}</span>
						{action.automationRunId ? " · a step in an automation" : ""}
					</p>
				</div>
				<div className="flex shrink-0 gap-2">
					<Button disabled={busy} onClick={() => void answer(false)}>
						Reject
					</Button>
					<Button variant="primary" disabled={busy} onClick={() => void answer(true)}>
						{busy ? "Working" : "Approve"}
					</Button>
				</div>
			</div>

			<details className="mt-3">
				<summary className="cursor-default text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					What it will be given
				</summary>
				<pre
					data-selectable
					className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--sunken)] p-3 font-mono text-[length:var(--text-sm)]"
				>
					{formatArgs(action.args)}
				</pre>
			</details>

			{menu.at ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={action.summary} />
			) : null}
		</div>
	);
}

function AnsweredRow({ action, onChanged, onNotice }: CardProps) {
	const [busy, setBusy] = useState(false);
	const menu = useContextMenu();

	async function clear() {
		if (busy) return;
		setBusy(true);
		try {
			await window.juno.agent.actions.remove(action.id);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const items: MenuItem[] = [
		{ id: "clear", label: "Clear", icon: "remove", disabled: busy, onSelect: () => void clear() },
	];

	return (
		<div
			onContextMenu={menu.open}
			className="flex items-center gap-3 border-b border-[var(--line)] px-2 py-2 hover:bg-[var(--hover)]"
		>
			<span
				className={`inline-block shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${ACTION_TONES[action.state]}`}
			>
				{ACTION_LABELS[action.state]}
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[length:var(--text-dense)]">{action.summary}</p>
				{action.error ? (
					<p data-selectable className="truncate text-[length:var(--text-sm)] text-[var(--risk)]">
						{action.error}
					</p>
				) : null}
			</div>
			<span className="tabular shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{formatWhen(action.decidedAt ?? action.createdAt)}
			</span>
			<Button size="dense" disabled={busy} onClick={() => void clear()}>
				Clear
			</Button>

			{menu.at ? (
				<ContextMenu at={menu.at} items={items} onClose={menu.close} ariaLabel={action.summary} />
			) : null}
		</div>
	);
}
