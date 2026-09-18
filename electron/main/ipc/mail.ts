/**
 * Mail channels. Thin: accounts in ../services/mail-accounts.ts, folders in
 * mail-folders.ts, the reader in mail-threads.ts, the engine in mail-sync.ts.
 *
 * Note what is absent. No channel returns a password, and no channel takes a
 * path: attachments are addressed by id and resolved inside the mail folder.
 */
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { copyFileSync } from "node:fs";
import type {
	MailAccountInput,
	MailAccountPatch,
	MailDraftInput,
	MailDraftPatch,
	MailOutboxListQuery,
	MailTemplateInput,
	MailTemplatePatch,
	MailThreadListQuery,
} from "../../shared/types";
import * as accounts from "../services/mail-accounts";
import * as folders from "../services/mail-folders";
import * as outbox from "../services/mail-outbox";
import * as sender from "../services/mail-send";
import * as sync from "../services/mail-sync";
import * as templates from "../services/mail-templates";
import * as threads from "../services/mail-threads";

export function registerMailIpc(): void {
	ipcMain.handle("mail.accounts.list", () => accounts.list());
	ipcMain.handle("mail.accounts.get", (_event, id: string) => accounts.get(id));
	ipcMain.handle("mail.accounts.create", (_event, input: MailAccountInput) => accounts.create(input));
	ipcMain.handle("mail.accounts.update", (_event, id: string, patch: MailAccountPatch) =>
		accounts.update(id, patch),
	);
	ipcMain.handle("mail.accounts.remove", (_event, id: string) => accounts.remove(id));
	ipcMain.handle("mail.accounts.test", (_event, input: Parameters<typeof accounts.test>[0]) =>
		accounts.test(input),
	);
	ipcMain.handle("mail.accounts.testSmtp", (_event, input: Parameters<typeof accounts.testSmtp>[0]) =>
		accounts.testSmtp(input),
	);

	ipcMain.handle("mail.folders.list", (_event, accountId: string) => folders.list(accountId));
	ipcMain.handle("mail.folders.setSyncEnabled", (_event, id: string, enabled: boolean) =>
		folders.setSyncEnabled(id, enabled),
	);

	ipcMain.handle("mail.sync.run", (_event, accountId?: string) =>
		accountId ? sync.syncAccount(accountId).then((s) => [s]) : sync.syncAll(),
	);
	ipcMain.handle("mail.sync.status", () => sync.status());

	ipcMain.handle("mail.threads.list", (_event, query?: MailThreadListQuery) =>
		threads.listThreads(query ?? {}),
	);
	ipcMain.handle("mail.threads.get", (_event, id: string) => threads.getThread(id));
	ipcMain.handle("mail.threads.linkClient", (_event, id: string, clientId: string) =>
		threads.linkClient(id, clientId),
	);
	ipcMain.handle("mail.threads.unlinkClient", (_event, id: string) => threads.unlinkClient(id));
	ipcMain.handle("mail.threads.countForClient", (_event, clientId: string) =>
		threads.countForClient(clientId),
	);

	ipcMain.handle("mail.messages.get", (_event, id: string) => threads.getMessage(id));
	ipcMain.handle("mail.messages.body", (_event, id: string) => threads.getBody(id));

	ipcMain.handle("mail.attachments.reveal", (_event, id: string) => {
		// Revealed, never opened. An attachment is an attacker's file until a
		// person decides otherwise, and that decision happens in the file manager.
		shell.showItemInFolder(threads.attachmentPath(id).path);
	});

	ipcMain.handle("mail.attachments.save", async (event, id: string) => {
		const { path, filename } = threads.attachmentPath(id);
		const owner = BrowserWindow.fromWebContents(event.sender);
		const result = owner
			? await dialog.showSaveDialog(owner, { defaultPath: filename })
			: await dialog.showSaveDialog({ defaultPath: filename });
		if (result.canceled || !result.filePath) return null;
		copyFileSync(path, result.filePath);
		return result.filePath;
	});

	ipcMain.handle("mail.openLink", async (_event, url: string) => {
		// The same rule as reminders.openAction: only a web address or a mailto
		// reaches the shell. Anything else from a message is data.
		if (!/^(https?:\/\/|mailto:)/i.test(url)) {
			throw new Error("That link is not a web address, so Bureau will not open it.");
		}
		await shell.openExternal(url);
	});

	ipcMain.handle("mail.templates.list", () => templates.list());
	ipcMain.handle("mail.templates.get", (_event, id: string) => templates.get(id));
	ipcMain.handle("mail.templates.create", (_event, input: MailTemplateInput) => templates.create(input));
	ipcMain.handle("mail.templates.update", (_event, id: string, patch: MailTemplatePatch) =>
		templates.update(id, patch),
	);
	ipcMain.handle("mail.templates.remove", (_event, id: string) => templates.remove(id));
	ipcMain.handle("mail.templates.render", (_event, input: Parameters<typeof templates.renderTemplate>[0]) =>
		templates.renderTemplate(input),
	);

	ipcMain.handle("mail.outbox.list", (_event, query?: MailOutboxListQuery) => outbox.list(query ?? {}));
	ipcMain.handle("mail.outbox.get", (_event, id: string) => outbox.get(id));
	ipcMain.handle("mail.outbox.counts", (_event, accountId?: string) => outbox.counts(accountId));
	ipcMain.handle("mail.outbox.createDraft", (_event, input: MailDraftInput) => outbox.createDraft(input));
	ipcMain.handle("mail.outbox.updateDraft", (_event, id: string, patch: MailDraftPatch) =>
		outbox.updateDraft(id, patch),
	);
	ipcMain.handle("mail.outbox.replySeed", (_event, messageId: string, all: boolean) =>
		outbox.replySeed(messageId, { all }),
	);
	// A person pressed Send. The actor is the one thing the adapter states, and
	// it is a fact about the caller, not a decision: this channel is only
	// reachable from the window. The agent's equivalent lives in ../mcp/mail.ts
	// and says "agent", which the service turns into a pending message.
	ipcMain.handle("mail.outbox.send", (_event, id: string) => outbox.requestSend(id, { actor: "user" }));
	// Approval has no MCP counterpart. A person in the app is the only approver.
	ipcMain.handle("mail.outbox.approve", (_event, id: string) => outbox.approve(id));
	ipcMain.handle("mail.outbox.cancel", (_event, id: string) => outbox.cancel(id));
	ipcMain.handle("mail.outbox.retry", (_event, id: string) => outbox.retry(id));
	ipcMain.handle("mail.outbox.remove", (_event, id: string) => outbox.remove(id));

	// Progress is pushed rather than polled, the same way the lock is.
	sync.onChange((status) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("mail.syncChanged", status);
		}
	});
	sender.onChange((message) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("mail.outboxChanged", message);
		}
	});
}
