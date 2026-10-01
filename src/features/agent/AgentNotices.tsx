import { useCallback, useEffect, useState } from "react";
import { Toast } from "../../components/Toast";
import { messageOf } from "../../lib/errors";
import { PairingDialog } from "./PairingDialog";

type Notice = {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
};

/**
 * Said once per run, not once per mount: unlocking the window remounts the
 * shell, and the same line again after every unlock would be noise.
 */
let startupNoticeShown = false;

/**
 * What the agent server says to the main window: where it is listening when
 * Juno starts, and the prompt a client raises the first time it connects.
 *
 * The startup line is Figma's: a short toast at the bottom with the address and
 * a button to copy it. It is the whole setup for a client, so it has to be
 * there without anybody going looking in settings.
 */
export function AgentNotices() {
	const [notice, setNotice] = useState<Notice | null>(null);

	const dismiss = useCallback(() => setNotice(null), []);

	useEffect(() => {
		if (startupNoticeShown) return;
		startupNoticeShown = true;

		window.juno.agent.server
			.status()
			.then((status) => {
				if (!status.enabled) return;
				if (!status.running) {
					setNotice({
						message: "MCP server could not start.",
						actionLabel: "Settings",
						onAction: () => {
							setNotice(null);
							void window.juno.window.openSettings("mcp");
						},
					});
					return;
				}
				setNotice({
					message: `MCP server enabled on ${status.url}`,
					actionLabel: "Copy URL",
					onAction: () => {
						navigator.clipboard
							.writeText(status.url)
							.then(() => setNotice({ message: "URL copied." }))
							.catch((cause: unknown) => setNotice({ message: messageOf(cause) }));
					},
				});
			})
			.catch(() => {
				// A server that cannot be asked about is not worth a notice on its own.
			});
	}, []);

	return (
		<>
			<PairingDialog onConnected={(name) => setNotice({ message: `${name} connected.` })} />
			{notice ? (
				<Toast
					// Keyed by the line, so a new notice gets its own countdown.
					key={notice.message}
					message={notice.message}
					actionLabel={notice.actionLabel}
					onAction={notice.onAction}
					onDismiss={dismiss}
				/>
			) : null}
		</>
	);
}
