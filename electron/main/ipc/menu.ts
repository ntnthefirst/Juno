/**
 * The right-click menu channel. Thin: the request is checked, and the menu is
 * built and answered by windows/context-menu.ts from the registry.
 *
 * Not an MCP tool, on purpose. A menu is how a person reaches the actions on a
 * record, and an agent reaches the same actions through their own tools.
 */
import { BrowserWindow, ipcMain } from "electron";
import { parseMenuIcons, parseMenuRequest } from "../../shared/menu";
import { setMenuIcons, showContextMenu } from "../windows/context-menu";

export function registerMenuIpc(): void {
	ipcMain.handle("menu.show", (event, raw: unknown) => {
		const request = parseMenuRequest(raw);
		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) return { type: "none" as const };
		return showContextMenu(window, request);
	});

	ipcMain.handle("menu.setIcons", (_event, raw: unknown) => {
		setMenuIcons(parseMenuIcons(raw));
	});
}
