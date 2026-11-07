import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ShellRequest } from "../../shared/types";
import * as desktop from "./desktop";
import * as settings from "./settings";

let locked = false;
let focused = 0;
let requests: ShellRequest[] = [];
let synced = 0;
/** The combinations another program already holds. */
let taken = new Set<string>();
let registered = new Map<string, () => void>();

beforeEach(() => {
	settings.configureSettings(mkdtempSync(join(tmpdir(), "juno-desktop-")));
	locked = false;
	focused = 0;
	requests = [];
	synced = 0;
	taken = new Set();
	registered = new Map();
	desktop.configure({
		supported: true,
		isLocked: () => locked,
		focusWindow: () => {
			focused += 1;
		},
		requestShell: (request) => requests.push(request),
		registerShortcut: (accelerator, run) => {
			if (taken.has(accelerator)) return false;
			registered.set(accelerator, run);
			return true;
		},
		releaseShortcut: (accelerator) => {
			registered.delete(accelerator);
		},
		syncSurfaces: () => {
			synced += 1;
		},
	});
});

describe("a new note from the tray or the shortcut", () => {
	it("is asked of the window while unlocked", () => {
		expect(desktop.newNote()).toBe("requested");
		expect(requests).toEqual([{ kind: "new-note" }]);
	});

	it("only shows the lock screen while locked, and makes nothing", () => {
		locked = true;
		expect(desktop.newNote()).toBe("locked");
		expect(requests).toEqual([]);
		expect(focused).toBe(1);
	});
});

describe("the global shortcut", () => {
	it("is off by default and registers nothing", async () => {
		const view = await desktop.getView();
		expect(view.settings.newNoteShortcut.enabled).toBe(false);
		expect((await desktop.applyShortcut()).registered).toBe(false);
		expect(registered.size).toBe(0);
	});

	it("is taken when turned on, and runs a new note when pressed", async () => {
		const view = await desktop.update({ newNoteShortcut: { enabled: true } });
		expect(view.shortcut).toEqual({ registered: true, problem: null });
		expect([...registered.keys()]).toEqual(["Ctrl+Alt+N"]);
		registered.get("Ctrl+Alt+N")!();
		expect(requests).toEqual([{ kind: "new-note" }]);
		expect(synced).toBe(1);
	});

	it("is released when turned off", async () => {
		await desktop.update({ newNoteShortcut: { enabled: true } });
		const view = await desktop.update({ newNoteShortcut: { enabled: false } });
		expect(registered.size).toBe(0);
		expect(view.shortcut.registered).toBe(false);
	});

	it("moves to a new combination without keeping the old one", async () => {
		await desktop.update({ newNoteShortcut: { enabled: true } });
		await desktop.update({ newNoteShortcut: { accelerator: "ctrl+shift+j" } });
		expect([...registered.keys()]).toEqual(["Ctrl+Shift+J"]);
	});

	it("says when another program already has the combination", async () => {
		taken.add("Ctrl+Alt+N");
		const view = await desktop.update({ newNoteShortcut: { enabled: true } });
		expect(view.shortcut.registered).toBe(false);
		expect(view.shortcut.problem).toMatch(/Ctrl\+Alt\+N is already used by another program/);
		expect(registered.size).toBe(0);
	});

	it("refuses a key with no modifier instead of storing it", async () => {
		await expect(desktop.update({ newNoteShortcut: { accelerator: "N" } })).rejects.toThrow(/modifier/);
		expect((await desktop.getView()).settings.newNoteShortcut.accelerator).toBe("Ctrl+Alt+N");
	});

	it("is released on quit", async () => {
		await desktop.update({ newNoteShortcut: { enabled: true } });
		desktop.releaseShortcut();
		expect(registered.size).toBe(0);
	});

	it("is never taken where the platform has none of this", async () => {
		desktop.configure({
			supported: false,
			isLocked: () => false,
			focusWindow: () => undefined,
			requestShell: () => undefined,
			registerShortcut: () => {
				throw new Error("must not register");
			},
			releaseShortcut: () => undefined,
			syncSurfaces: () => undefined,
		});
		await settings.setDesktop({ newNoteShortcut: { enabled: true } });
		expect((await desktop.applyShortcut()).registered).toBe(false);
		expect((await desktop.getView()).supported).toBe(false);
	});
});

describe("the other switches", () => {
	it("stand alone and bring the tray and badge in line", async () => {
		const view = await desktop.update({ badge: false });
		expect(view.settings).toMatchObject({ toasts: true, tray: true, badge: false });
		expect(synced).toBe(1);
	});

	it("report whether closing the window keeps Juno running", async () => {
		expect((await desktop.getView()).keepRunning).toBe(true);
		await settings.setMcpServer({ background: false });
		expect((await desktop.getView()).keepRunning).toBe(false);
	});
});
