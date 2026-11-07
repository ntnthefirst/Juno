import type { MailRuleRun } from "@shared/types";
import { formatWhen } from "../../mail/format";
import { failedWords, runWords, skippedWords } from "./rule-draft";

type AccountRuleHistoryProps = {
	runs: MailRuleRun[] | null;
};

const RESULT_TONE = {
	done: "text-[var(--ok)]",
	skipped: "text-[var(--ink-muted)]",
	failed: "text-[var(--risk)]",
};

/**
 * What the rules did, newest first: the answer to "why did this message move".
 * The subject and sender are text the sender chose. They are drawn as text, and
 * cut to one line each.
 */
export function AccountRuleHistory({ runs }: AccountRuleHistoryProps) {
	if (runs === null) return <p className="text-[var(--ink-muted)]">Loading.</p>;
	if (runs.length === 0) {
		return <p className="max-w-[62ch] text-[var(--ink-muted)]">Nothing yet. A rule's actions are listed here as they happen.</p>;
	}
	return (
		<ol aria-label="What rules did" className="flex flex-col">
			{runs.map((run) => (
				<li
					key={run.id}
					className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 border-b border-[var(--line)]/60 py-2 text-dense last:border-b-0"
				>
					<span className="tabular pt-0.5 text-sm text-[var(--ink-muted)]">{formatWhen(run.createdAt)}</span>
					<div className="min-w-0">
						<p className="truncate">
							<span className={`font-[var(--weight-medium)] ${RESULT_TONE[run.result]}`}>
								{run.result === "done" ? runWords(run) : run.result === "failed" ? failedWords(run) : skippedWords(run)}
							</span>
							<span className="text-[var(--ink-muted)]"> by </span>
							<span className="font-[var(--weight-medium)]">{run.ruleName}</span>
						</p>
						<p className="truncate text-sm text-[var(--ink-muted)]">
							{run.subject || "(no subject)"}
							{run.fromAddress ? ` from ${run.fromAddress}` : ""}
						</p>
						{run.error ? (
							<p data-selectable className={`text-sm ${RESULT_TONE[run.result]}`}>
								{run.error}
							</p>
						) : null}
					</div>
				</li>
			))}
		</ol>
	);
}
