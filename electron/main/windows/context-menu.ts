/**
 * Draws a right-click menu with the platform's own `Menu.popup`, so it looks
 * and behaves like every other menu on the machine.
 *
 * The list comes from the registry (services/menu-registry.ts), built from the
 * record, never from the page. Choosing an item is turned into an outcome the
 * window can act on: the main process performs what it can through a service,
 * and names the rest.
 *
 * The lock is checked here as well as in the IPC guard. A menu is a way to
 * reach a record, and a locked application has none to offer.
 */
import { BrowserWindow, Menu, nativeImage, type MenuItemConstructorOptions, type NativeImage } from "electron";
import {
	MENU_ACTIONS,
	type MenuIcon,
	type MenuIconSet,
	MENU_MAIN_ACTIONS,
	type MenuAction,
	type MenuEntry,
	type MenuMainAction,
	type MenuOutcome,
	type MenuRequest,
} from "../../shared/menu";
import * as lock from "../services/lock";
import * as actions from "../services/menu-actions";
import { entriesFor } from "../services/menu-registry";

const isUiAction = (id: string): id is MenuAction => (MENU_ACTIONS as readonly string[]).includes(id);
const isMainAction = (id: string): id is MenuMainAction => (MENU_MAIN_ACTIONS as readonly string[]).includes(id);

/** What choosing an entry means. The main process does it, or the window is told to. */
async function outcomeOf(request: MenuRequest, entry: MenuEntry): Promise<MenuOutcome> {
	if (isMainAction(entry.id)) return actions.perform(request, entry.id);
	if (isUiAction(entry.id)) return { type: "ui", action: entry.id };
	return { type: "none" };
}

/** The pictures beside the labels, drawn by the renderer in the colour of the current theme. */
let icons = new Map<MenuIcon, NativeImage>();

export function setMenuIcons(set: MenuIconSet): void {
	const next = new Map<MenuIcon, NativeImage>();
	for (const [name, url] of Object.entries(set) as [MenuIcon, string][]) {
		// Drawn at twice the size they are shown, so they stay sharp on a scaled display.
		const base64 = url.slice(url.indexOf(",") + 1);
		const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"), { scaleFactor: 2 });
		if (!image.isEmpty()) next.set(name, image);
	}
	icons = next;
}

function template(entries: MenuEntry[], choose: (entry: MenuEntry) => void): MenuItemConstructorOptions[] {
	const out: MenuItemConstructorOptions[] = [];
	entries.forEach((entry, index) => {
		if (entry.separatorBefore && index > 0) out.push({ type: "separator" });
		out.push({
			label: entry.label,
			...(entry.icon && icons.has(entry.icon) ? { icon: icons.get(entry.icon) } : {}),
			// Drawn beside the label and never registered, because the screen
			// already listens for the key and a second listener would run it twice.
			...(entry.accelerator ? { accelerator: entry.accelerator, registerAccelerator: false } : {}),
			click: () => choose(entry),
		});
	});
	return out;
}

export async function showContextMenu(window: BrowserWindow, request: MenuRequest): Promise<MenuOutcome> {
	if (lock.isLocked()) return { type: "none" };

	const entries = await entriesFor(request);
	if (entries.length === 0) return { type: "none" };

	return new Promise<MenuOutcome>((resolve) => {
		let chosen: Promise<MenuOutcome> | null = null;
		const menu = Menu.buildFromTemplate(
			template(entries, (entry) => {
				chosen = outcomeOf(request, entry);
			}),
		);
		menu.popup({
			window,
			x: request.x,
			y: request.y,
			// Called when the menu closes, with or without a choice. The click
			// handler runs first on every platform, and the turn of the loop
			// covers the one where it does not.
			callback: () => {
				setTimeout(() => {
					void (chosen ?? Promise.resolve<MenuOutcome>({ type: "none" })).then(resolve);
				}, 0);
			},
		});
	});
}
