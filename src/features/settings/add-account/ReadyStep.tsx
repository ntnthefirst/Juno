import type { ReactNode } from "react";
import type { MailAccount, MailConnectResult, MailDirectionCheck } from "@shared/types";
import { Icon } from "../../../components/Icon";
import { Toggle } from "../../../components/Toggle";

type ReadyStepProps = {
	/** Null while both directions are being tried. */
	result: MailConnectResult | null;
	/** The hosts being tried, shown while the result is still coming. */
	hosts: { imap: string; smtp: string };
	mail: boolean;
	onMail: (on: boolean) => void;
	/**
	 * More rows under "Bring in", for the account just added. This is where a
	 * "subscribe to this account's calendar" row goes once calendar
	 * subscriptions exist; until then nothing is passed and nothing is drawn.
	 */
	calendarSlot?: (account: MailAccount) => ReactNode;
	error: string | null;
};

/**
 * Both directions tried, each with its host, or a plain sentence saying what
 * to change. The account exists only once both worked, so "Bring in" is drawn
 * only then.
 */
export function ReadyStep({ result, hosts, mail, onMail, calendarSlot, error }: ReadyStepProps) {
	const account = result?.account ?? null;
	return (
		<div className="flex flex-col gap-4">
			<ul className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2">
				<CheckRow label="Receiving mail" check={result?.receiving ?? null} host={hosts.imap} />
				<CheckRow label="Sending mail" check={result?.sending ?? null} host={hosts.smtp} />
			</ul>

			{error ? (
				<p role="alert" data-selectable className="border-l-2 border-[var(--risk)] pl-3 text-sm text-[var(--risk)]">
					{error}
				</p>
			) : null}

			{account ? (
				<section className="flex animate-rise flex-col gap-3">
					<h2 className="text-h3">Bring in</h2>
					<Toggle
						label="Mail"
						description={`The last ${account.horizonDays} days now, and the rest from the end of the mail list.`}
						checked={mail}
						onChange={onMail}
					/>
					{calendarSlot ? calendarSlot(account) : null}
				</section>
			) : null}
		</div>
	);
}

type CheckRowProps = {
	label: string;
	check: MailDirectionCheck | null;
	host: string;
};

function CheckRow({ label, check, host }: CheckRowProps) {
	const state = check === null ? "checking" : check.ok ? "ok" : "failed";
	return (
		<li className="flex flex-col py-1.5" role={state === "failed" ? "alert" : undefined}>
			<div className="flex min-h-[32px] items-center gap-3">
				<span
					aria-hidden
					className={[
						"flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-full)]",
						state === "ok"
							? "bg-[var(--ok-soft)] text-[var(--ink)]"
							: state === "failed"
								? "bg-[var(--risk-soft)] text-[var(--risk)]"
								: "border border-[var(--line-strong)]",
					].join(" ")}
				>
					{state === "ok" ? <Icon name="check" size={14} /> : state === "failed" ? <Icon name="close" size={14} /> : null}
				</span>
				<span className="flex-1 text-base font-[var(--weight-medium)] text-[var(--ink)]">
					{state === "ok" ? `${label} works` : state === "failed" ? `${label} does not work yet` : `Trying ${label.toLowerCase()}`}
				</span>
				<span className="truncate text-sm text-[var(--ink-muted)]">{check?.host ?? host}</span>
			</div>
			{check?.message ? (
				<p data-selectable className="ml-9 text-sm text-[var(--ink-muted)]">
					{check.message}
				</p>
			) : null}
		</li>
	);
}
