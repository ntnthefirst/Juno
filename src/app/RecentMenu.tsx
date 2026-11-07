import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecentItem, RecentKind } from "@shared/types";
import { Icon, type IconName } from "../components/Icon";
import { messageOf } from "../lib/errors";
import { requestOpenClient } from "../lib/open-client";
import { requestOpen } from "../lib/open-entity";
import { recentDay } from "../lib/recent-day";

type RecentMenuProps = {
	/** The corner under the button the menu hangs from. */
	at: { x: number; y: number };
	onClose: () => void;
};

const KIND: Record<RecentKind, { label: string; icon: IconName }> = {
	client: { label: "Client", icon: "clients" },
	project: { label: "Project", icon: "projects" },
	document: { label: "Document", icon: "documents" },
	thread: { label: "Mail", icon: "mail" },
	note: { label: "Note", icon: "note" },
};

function open(item: RecentItem): void {
	if (item.kind === "client") requestOpenClient(item.recordId, item.name);
	else if (item.kind === "project") requestOpen({ kind: "project", id: item.recordId, name: item.name });
	else if (item.kind === "note") requestOpen({ kind: "note", id: item.recordId });
	else if (item.kind === "document") requestOpen({ kind: "document", id: item.recordId, name: item.name });
	else requestOpen({ kind: "thread", id: item.recordId, messageId: null });
}

/**
 * The records opened last, newest first, as a list under the Recent button.
 * Choosing one opens it the way a click on it elsewhere would. The foot of the
 * list empties it, which leaves every record as it was.
 */
export function RecentMenu({ at, onClose }: RecentMenuProps) {
	const [items, setItems] = useState<RecentItem[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [active, setActive] = useState(0);
	const surface = useRef<HTMLDivElement>(null);
	const [left, setLeft] = useState(at.x);

	useEffect(() => {
		let cancelled = false;
		window.juno.recent
			.list()
			.then((rows) => {
				if (!cancelled) setItems(rows);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useLayoutEffect(() => {
		const width = surface.current?.getBoundingClientRect().width ?? 0;
		setLeft(Math.max(8, Math.min(at.x, window.innerWidth - 8 - width)));
	}, [at.x, items]);

	const count = items?.length ?? 0;

	function choose(item: RecentItem | undefined) {
		if (!item) return;
		onClose();
		// After the menu has gone, so what opens lands on a screen with nothing over it.
		window.setTimeout(() => open(item), 0);
	}

	// The key listener is added once per list, and reads the row to open from here.
	const latest = useRef({ items, active, choose });
	useEffect(() => {
		latest.current = { items, active, choose };
	});

	async function clear() {
		try {
			await window.juno.recent.clear();
			onClose();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		}
	}

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			} else if (event.key === "ArrowDown" && count > 0) {
				event.preventDefault();
				setActive((current) => (current + 1) % count);
			} else if (event.key === "ArrowUp" && count > 0) {
				event.preventDefault();
				setActive((current) => (current - 1 + count) % count);
			} else if (event.key === "Enter") {
				event.preventDefault();
				latest.current.choose(latest.current.items?.[latest.current.active]);
			} else if (event.key === "Tab") {
				onClose();
			}
		}
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [count, onClose]);

	return createPortal(
		<>
			<div
				data-popover-root
				className="fixed inset-0 z-[60]"
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}}
			/>
			<div
				ref={surface}
				role="menu"
				aria-label="Recent"
				className="animate-scale fixed z-[61] w-[280px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-2"
				style={{ left, top: at.y, boxShadow: "var(--shadow-popover)" }}
			>
				<p className="px-2 pt-1 pb-1.5 text-overline uppercase text-[var(--ink-muted)]">Recent</p>
				{error ? (
					<p className="px-2 py-3 text-dense text-[var(--risk)]">{error}</p>
				) : items === null ? (
					<p className="px-2 py-3 text-dense text-[var(--ink-muted)]">Loading.</p>
				) : items.length === 0 ? (
					<p className="px-2 py-3 text-dense text-[var(--ink-muted)]">Records you open will be listed here.</p>
				) : (
					<ul className="max-h-[420px] overflow-y-auto">
						{items.map((item, index) => (
							<li key={item.id}>
								<button
									type="button"
									role="menuitem"
									onMouseEnter={() => setActive(index)}
									onClick={() => choose(item)}
									className={[
										"flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-left",
										active === index ? "bg-[var(--hover)]" : "",
									].join(" ")}
								>
									<Icon name={KIND[item.kind].icon} size={16} className="flex-none text-[var(--ink-muted)]" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-dense font-[var(--weight-medium)] text-[var(--ink)]">{item.name}</span>
										<span className="block truncate text-sm text-[var(--ink-muted)]">
											{[KIND[item.kind].label, item.context].filter(Boolean).join(" · ")}
										</span>
									</span>
									<span className="tabular flex-none text-sm text-[var(--ink-muted)]">{recentDay(item.openedAt)}</span>
								</button>
							</li>
						))}
					</ul>
				)}
				{count > 0 ? (
					<div className="mt-1 border-t border-[var(--line)] pt-1">
						<button
							type="button"
							role="menuitem"
							onClick={() => void clear()}
							className="w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-dense text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
						>
							Clear recent
						</button>
					</div>
				) : null}
			</div>
		</>,
		document.body,
	);
}
