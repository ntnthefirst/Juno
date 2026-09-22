import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SettingsWindow } from "./app/SettingsWindow";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

/**
 * Two windows, one bundle, one entry.
 *
 * The window says which shell it wants in its own URL, which the main process
 * set when it created the window. Reading it here rather than asking over IPC
 * means the right shell paints on the first frame, and that a locked
 * application still knows what it is drawing.
 */
const isSettings = window.location.hash === "#/settings";

createRoot(root).render(
	<StrictMode>{isSettings ? <SettingsWindow /> : <App />}</StrictMode>,
);
