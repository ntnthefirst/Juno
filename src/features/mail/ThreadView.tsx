import { useEffect, useState } from "react";
import type { MailThread } from "@shared/types";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { LinkClientDialog } from "./LinkClientDialog";
import { MessageView } from "./MessageView";

type ThreadViewProps = {
	threadId: string;
	/** The thread's link changed, so the list needs a refresh. */
	onChanged: () => void;
	onNotice: (message: string) => void;
	onReply: (messageId: string, all: boolean) => void;
};

type Load =
	| { status: "loading" }
	| { status: "ready"; thread: MailThread }
	| { status: "error"; message: string };

export function ThreadView({ threadId, onChanged, onNotice, onReply }: ThreadViewProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [linking, setLinking] = useState(false);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		let cancelled = false;
		window.bureau.mail.threads
			.get(threadId)
			.then((thread) => {
				if (cancelled) return;
				setLoad(thread ? { status: "ready", thread } : { status: "error", message: "That thread is gone." });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [threadId, version]);

	async function unlink() {
		try {
			await window.bureau.mail.threads.unlinkClient(threadId);
			setVersion((v) => v + 1);
			onChanged();
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	if (load.status === "loading") {
		return <p className="p-8 text-[var(--ink-muted)]">Loading.</p>;
	}
	if (load.status === "error") {
		return (
			<div className="p-8">
				<p data-selectable className="text-[var(--risk)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { summary, messages } = load.thread;
	// Everything read is collapsed except the newest, which is what a person
	// opened the thread for. Unread ones stay open too.
	const openByDefault = new Set(
		messages.filter((m, index) => !m.isSeen || index === messages.length - 1).map((m) => m.id),
	);

	return (
		<div className="px-8 py-6">
			<div className="flex items-start justify-between gap-6">
				<h2 className="min-w-0 text-[length:var(--text-h2)] font-[var(--weight-semibold)] leading-[var(--leading-tight)] tracking-[-0.01em]">
					{summary.subject}
				</h2>
				<div className="flex shrink-0 items-center gap-2">
					{summary.clientName ? (
						<>
							<span className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--accent)]">
								{summary.clientName}
								{summary.linkSource === "auto" ? (
									<span className="text-[var(--ink-muted)]"> (matched)</span>
								) : null}
							</span>
							<Button size="dense" onClick={() => setLinking(true)}>
								Change
							</Button>
							<Button size="dense" onClick={() => void unlink()}>
								Unlink
							</Button>
						</>
					) : (
						<Button size="dense" onClick={() => setLinking(true)}>
							Link to client
						</Button>
					)}
				</div>
			</div>
			<p className="tabular mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{messages.length} {messages.length === 1 ? "message" : "messages"}
			</p>

			<div className="mt-6 flex flex-col gap-4">
				{messages.map((message) => (
					<MessageView
						key={message.id}
						message={message}
						initiallyOpen={openByDefault.has(message.id)}
						onNotice={onNotice}
						onReply={onReply}
					/>
				))}
			</div>

			{linking ? (
				<LinkClientDialog
					threadId={threadId}
					currentClientId={summary.clientId}
					onClose={() => setLinking(false)}
					onLinked={() => {
						setLinking(false);
						setVersion((v) => v + 1);
						onChanged();
					}}
				/>
			) : null}
		</div>
	);
}
