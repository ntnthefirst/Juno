/**
 * The bridge, and the entire surface the renderer has.
 *
 * Two rules this file exists to keep:
 * - It exposes methods, never `ipcRenderer` itself. Handing the renderer a
 *   general-purpose `invoke` would make the allow-list in
 *   main/ipc/lock-guard.ts pointless and let any future renderer bug reach any
 *   channel.
 * - Nothing here returns a credential. `lock.unlock` offers a secret and gets a
 *   yes or no back. There is no method that reads one.
 *
 * The shape is checked against BureauApi at the bottom, so a channel that drifts
 * from the contract fails the typecheck rather than at runtime.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { BureauApi } from "./shared/api";
import type { LockState } from "./shared/types";

const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
	ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: BureauApi = {
	app: {
		info: () => call("app.info"),
	},

	clients: {
		list: (query) => call("clients.list", query),
		get: (id) => call("clients.get", id),
		create: (input) => call("clients.create", input),
		update: (id, patch) => call("clients.update", id, patch),
		remove: (id) => call("clients.remove", id),
		restore: (id) => call("clients.restore", id),
	},

	contacts: {
		listForClient: (clientId) => call("contacts.listForClient", clientId),
		create: (input) => call("contacts.create", input),
		update: (id, patch) => call("contacts.update", id, patch),
		remove: (id) => call("contacts.remove", id),
		restore: (id) => call("contacts.restore", id),
		setPrimary: (id) => call("contacts.setPrimary", id),
	},

	projects: {
		list: (query) => call("projects.list", query),
		get: (id) => call("projects.get", id),
		create: (input) => call("projects.create", input),
		update: (id, patch) => call("projects.update", id, patch),
		remove: (id) => call("projects.remove", id),
		restore: (id) => call("projects.restore", id),
	},

	reference: {
		listSets: () => call("reference.listSets"),
		getSet: (key) => call("reference.getSet", key),
		createItem: (input) => call("reference.createItem", input),
		updateItem: (id, patch) => call("reference.updateItem", id, patch),
		hideItem: (id) => call("reference.hideItem", id),
		unhideItem: (id) => call("reference.unhideItem", id),
		usage: (id) => call("reference.usage", id),
		reorder: (setId, orderedIds) => call("reference.reorder", setId, orderedIds),
		resetSet: (key, userItems) => call("reference.resetSet", key, userItems),
		resetAll: (userItems) => call("reference.resetAll", userItems),
	},

	settings: {
		get: () => call("settings.get"),
		getSignaturePath: () => call("settings.getSignaturePath"),
		getSignatureImage: () => call("settings.getSignatureImage"),
		chooseSignature: () => call("settings.chooseSignature"),
		clearSignature: () => call("settings.clearSignature"),
		getTheme: () => call("settings.getTheme"),
		setTheme: (theme) => call("settings.setTheme", theme),
		getAccountingTool: () => call("settings.getAccountingTool"),
		setAccountingTool: (patch) => call("settings.setAccountingTool", patch),
		getOwner: () => call("settings.getOwner"),
		setOwner: (patch) => call("settings.setOwner", patch),
	},

	lock: {
		state: () => call("lock.state"),
		getSettings: () => call("lock.getSettings"),
		setSettings: (patch) => call("lock.setSettings", patch),
		configure: (input) => call("lock.configure", input),
		disable: (currentSecret) => call("lock.disable", currentSecret),
		lock: () => call("lock.lock"),
		unlock: (secret) => call("lock.unlock", secret),
		onChange: (listener) => {
			const handler = (_event: Electron.IpcRendererEvent, state: LockState) => listener(state);
			ipcRenderer.on("lock.changed", handler);
			return () => {
				ipcRenderer.off("lock.changed", handler);
			};
		},
	},

	backup: {
		create: () => call("backup.create"),
		list: () => call("backup.list"),
		restore: (path) => call("backup.restore", path),
		revealFolder: () => call("backup.revealFolder"),
	},

	search: {
		global: (term, limit) => call("search.global", term, limit),
	},

	templates: {
		list: () => call("templates.list"),
		get: (id) => call("templates.get", id),
		create: (input) => call("templates.create", input),
		update: (id, patch) => call("templates.update", id, patch),
		setReviewed: (id, reviewed) => call("templates.setReviewed", id, reviewed),
		remove: (id) => call("templates.remove", id),
		preview: (input) => call("templates.preview", input),
	},

	documents: {
		list: (query) => call("documents.list", query),
		get: (id) => call("documents.get", id),
		generate: (input) => call("documents.generate", input),
		setStatus: (id, statusId) => call("documents.setStatus", id, statusId),
		remove: (id) => call("documents.remove", id),
		restore: (id) => call("documents.restore", id),
		previewHtml: (id) => call("documents.previewHtml", id),
		renderPdf: (id) => call("documents.renderPdf", id),
		sign: (input) => call("documents.sign", input),
		signatures: (documentId) => call("documents.signatures", documentId),
		openPdf: (id) => call("documents.openPdf", id),
		revealPdf: (id) => call("documents.revealPdf", id),
	},

	reminders: {
		list: (query) => call("reminders.list", query),
		get: (id) => call("reminders.get", id),
		create: (input) => call("reminders.create", input),
		update: (id, patch) => call("reminders.update", id, patch),
		complete: (id, note) => call("reminders.complete", id, note),
		snooze: (id, until) => call("reminders.snooze", id, until),
		reopen: (id) => call("reminders.reopen", id),
		remove: (id) => call("reminders.remove", id),
		restore: (id) => call("reminders.restore", id),
		history: (id) => call("reminders.history", id),
		suggestions: () => call("reminders.suggestions"),
		accept: (suggestion) => call("reminders.accept", suggestion),
		openAction: (id) => call("reminders.openAction", id),
	},
};

contextBridge.exposeInMainWorld("bureau", api);
