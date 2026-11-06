import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type NoticeTone = "warn" | "info" | "risk";

const TONES: Record<NoticeTone, { box: string; icon: IconName }> = {
	warn: { box: "bg-[var(--warn-soft)] text-[var(--warn)]", icon: "warning" },
	info: { box: "bg-[var(--accent-soft)] text-[var(--accent)]", icon: "info" },
	risk: { box: "bg-[var(--risk-soft)] text-[var(--risk)]", icon: "warning" },
};

type NoticeProps = {
	tone?: NoticeTone;
	children: ReactNode;
	/** Buttons at the right, for what to do about it. */
	actions?: ReactNode;
	/** Another glyph than the tone's own. */
	icon?: IconName;
	/**
	 * A band runs the width of what it sits above, with the page's own side
	 * padding. Inline is a rounded box inside a column.
	 */
	layout?: "band" | "inline";
	role?: "status" | "alert";
};

/**
 * A line of fact above content: always words, with an icon, and what to do next
 * when it is an error. The tone is the only colour choice.
 */
export function Notice({ tone = "warn", children, actions, icon, layout = "band", role }: NoticeProps) {
	const metrics =
		layout === "band"
			? "min-h-[40px] flex-wrap px-8 py-2"
			: "rounded-[var(--radius-md)] px-3 py-2.5";

	return (
		<div role={role} className={`flex shrink-0 items-center gap-3 text-base ${metrics} ${TONES[tone].box}`}>
			<Icon name={icon ?? TONES[tone].icon} size={16} className="flex-none" />
			<div className="min-w-0 flex-1">{children}</div>
			{actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
		</div>
	);
}
