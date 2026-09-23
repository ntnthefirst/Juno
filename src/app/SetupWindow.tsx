import { SetupFlow } from "../features/onboarding/SetupFlow";
import { overlayGutter } from "../lib/platform";

/**
 * The first-run window.
 *
 * Small, fixed and modal in front of the application it is about to configure
 * (electron/main/windows/setup-window.ts). It draws its own title bar strip,
 * like the settings window, and leaves the operating system's caption buttons
 * the room they are drawn in.
 *
 * Escape is deliberately not a way out, and neither is the close button: setup
 * cannot be skipped as a whole, so closing this window quits Juno instead
 * (main/windows/index.ts). What can be skipped is most of the inside of it:
 * appearance, the lock and mail are optional a step at a time, and only the
 * owner's name and the business name are required, because every generated
 * document carries both.
 */
export function SetupWindow() {
	return (
		<div className="flex h-full flex-col bg-[var(--paper)]">
			<header
				className="drag-region flex flex-none items-center border-b border-[var(--line)]"
				style={{
					height: "var(--titlebar-height)",
					paddingLeft: overlayGutter.left,
					paddingRight: overlayGutter.right,
				}}
			>
				<span className="text-[length:var(--text-sm)] font-[var(--weight-semibold)]">Set up Juno</span>
			</header>

			<div className="min-h-0 flex-1">
				<SetupFlow onFinished={() => void window.juno.window.closeSetup()} />
			</div>
		</div>
	);
}
