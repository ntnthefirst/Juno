import { useState } from "react";
import type { ClaudeDesktopSetup } from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { ClientLogo } from "./client-logos";

type ClaudeDesktopConnectProps = {
	onNotice: (message: string) => void;
	serverRunning: boolean;
};

/**
 * Claude Desktop, which takes an extension rather than an address.
 *
 * One press makes a token for it, writes `Juno.mcpb` and opens it, which brings
 * up Claude's own install dialog. That dialog asks for the token, so it is
 * shown here once with a Copy button, the way a token made by hand is.
 */
export function ClaudeDesktopConnect({ onNotice, serverRunning }: ClaudeDesktopConnectProps) {
	const [busy, setBusy] = useState(false);
	const [setup, setSetup] = useState<ClaudeDesktopSetup | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function connect() {
		setBusy(true);
		setError(null);
		try {
			setSetup(await window.juno.agent.claudeDesktop.connect());
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function copy(text: string, notice: string) {
		try {
			await navigator.clipboard.writeText(text);
			onNotice(notice);
		} catch (cause: unknown) {
			onNotice(messageOf(cause));
		}
	}

	return (
		<div className="border-b border-[var(--line)] pb-4">
			<div className="flex flex-wrap items-center gap-3">
				<span className="flex h-8 w-8 flex-none items-center justify-center text-[var(--ink)]">
					<ClientLogo clientId="claude-desktop" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-[var(--weight-medium)]">Claude Desktop</span>
					<span className="mt-0.5 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						Installed as an extension, so Juno's tools are in every chat in the desktop app.
					</span>
				</span>
				<Button size="dense" variant="primary" disabled={busy || !serverRunning} onClick={() => void connect()}>
					{busy ? "Preparing" : setup ? "Connect again" : "Connect"}
				</Button>
			</div>

			{error ? (
				<p
					role="alert"
					data-selectable
					className="mt-2 border-l-2 border-[var(--risk)] pl-3 text-[length:var(--text-sm)] text-[var(--risk)]"
				>
					{error}
				</p>
			) : null}

			{setup ? (
				<div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4">
					<p className="font-[var(--weight-medium)]">
						{setup.opened ? "Claude is asking to install Juno." : "The extension is ready."}
					</p>
					<ol className="mt-2 flex max-w-[68ch] list-decimal flex-col gap-1 pl-5 text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						{setup.opened ? null : (
							<li>
								Open the file below in Claude Desktop, or drag it onto Settings &gt; Extensions there.
							</li>
						)}
						<li>Press Install in Claude's dialog.</li>
						<li>Paste this token into the Access token field and save.</li>
						<li>Start a new chat. The tools answer while Juno is open.</li>
					</ol>

					<div className="mt-3 flex items-center gap-2">
						<p
							data-selectable
							className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-[var(--sunken)] px-3 py-2 font-mono text-[length:var(--text-sm)] text-[var(--ink)]"
						>
							{setup.token}
						</p>
						<Button size="dense" onClick={() => void copy(setup.token, "Token copied.")}>
							<Icon name="copy" />
							Copy
						</Button>
					</div>
					<p className="mt-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						It is not shown again. Claude keeps it in the system keychain.
					</p>
					<p
						data-selectable
						className="mt-3 font-mono text-[length:var(--text-micro)] text-[var(--ink-faint)]"
					>
						{setup.path}
					</p>
					<div className="mt-3">
						<Button size="dense" onClick={() => setSetup(null)}>
							Done
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
