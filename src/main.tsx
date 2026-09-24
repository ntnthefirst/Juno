import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { EditMenu } from "./components/EditMenu";
import { SettingsWindow } from "./app/SettingsWindow";
import { SetupWindow } from "./app/SetupWindow";
import { viewFromHash } from "./lib/window-view";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

/**
 * Three windows, one bundle, one entry.
 *
 * The window says which shell it wants in its own URL, which the main process
 * set when it created the window. Reading it here rather than asking over IPC
 * means the right shell paints on the first frame, and that a locked
 * application still knows what it is drawing.
 */
const view = viewFromHash(window.location.hash);

createRoot(root).render(
	<StrictMode>
		{/* Every window gets the fallback right-click menu, because a text field
		    with no cut and paste on it reads as broken wherever it sits. */}
		<EditMenu />
		{view.kind === "settings" ? (
			<SettingsWindow initialSection={view.section} />
		) : view.kind === "setup" ? (
			<SetupWindow />
		) : (
			<App />
		)}
	</StrictMode>,
);
