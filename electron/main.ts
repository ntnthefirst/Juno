/**
 * Entry point. Order matters more than usual here, so it is spelled out.
 *
 * 1. Scheme privileges, before ready. Electron ignores them afterwards.
 * 2. Single instance. Two processes on one SQLite file is corruption waiting.
 * 3. Database open and migrate, before anything can read it.
 * 4. Lock started, before IPC, so the guard has real state to consult.
 * 5. IPC registered, guard first.
 * 6. Window last, so it never paints against a half-built backend.
 */
import { app, nativeTheme } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeDb, getConnection, openDb } from "./main/db";
import { runMigrations } from "./main/db/migrate";
import { backupsDir, databasePath, documentsDir, mailDir, projectsDir, userDataDir } from "./main/db/paths";
import { safeStorageCredentialStore } from "./main/credential-store";
import { registerAllIpc } from "./main/ipc";
import { mcpStatus } from "./main/ipc/agent";
import { configureAgentInstall } from "./main/services/agent-install";
import { startAgentSurface, startAutomationScheduler, stopAgentSurface } from "./main/mcp";
import { registerAppScheme, registerAppSchemePrivileges } from "./main/scheme";
import { configureBackups, setCloseHook } from "./main/services/backup";
import { configureDocuments } from "./main/services/document-pdf";
import { ensureTemplatesSeeded } from "./main/services/document-templates";
import { configureDocumentStorage } from "./main/services/documents";
import { configureProjectStorage } from "./main/services/project-storage";
import * as projectRunner from "./main/services/project-runner";
import * as notifications from "./main/services/notifications";
import { ensureRemindersSeeded } from "./main/services/reminders-derive";
import * as lock from "./main/services/lock";
import * as documentActions from "./main/services/document-actions";
import { configureCredentialStore } from "./main/services/mail-credentials";
import { openImapWriter } from "./main/services/mail-imap-write";
import { openImapSource } from "./main/services/mail-imap";
import { configureMailboxSource } from "./main/services/mail-source";
import { configureMailboxWriter } from "./main/services/mail-writer";
import * as mailSend from "./main/services/mail-send";
import { imapSentAppender, smtpTransport } from "./main/services/mail-smtp";
import * as mailSync from "./main/services/mail-sync";
import { ensureMailTemplatesSeeded } from "./main/services/mail-templates";
import { configureMailTransport } from "./main/services/mail-transport";
import { configureMailThreads } from "./main/services/mail-threads";
import { ensureSeeded } from "./main/services/seed";
import * as settings from "./main/services/settings";
import { focusMainWindow, getMainWindow, openMainWindow } from "./main/windows";
import { applyDevDockIcon, installSessionPolicy } from "./main/windows/chrome";
import { closeSplash, showSplash, splashStep } from "./main/windows/splash";
import { startUpdates } from "./main/services/updates";
import { devDataDir } from "./main/dev-data";

const isDev = Boolean(process.env.JUNO_DEV);

// A development run never touches installed data. Set before anything reads a
// path, because app.getPath("userData") is resolved on first use and cached.
if (isDev) app.setPath("userData", devDataDir());

registerAppSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	// One main window, and a second launch focuses it rather than opening one.
	// windows/index.ts is what actually holds that rule.
	app.on("second-instance", () => focusMainWindow());

	app.whenReady().then(async () => {
		// Before the first window, so the splash is the first thing carrying the
		// right icon rather than the second.
		applyDevDockIcon();

		// Up before any of the slow work, and down when the window can paint.
		// A smoke run has nobody watching and an always-on-top window would sit
		// over the screenshots it takes.
		if (!process.env.JUNO_SMOKE) showSplash();

		// Paths are injected here rather than read inside each service, so no
		// service has to import `electron` and every one stays testable in plain
		// Node.
		settings.configureSettings(userDataDir());
		configureBackups({ directory: backupsDir(), databaseFile: databasePath() });
		configureDocuments(documentsDir());
		configureDocumentStorage(documentsDir());
		configureProjectStorage(projectsDir());
		configureMailThreads(mailDir());
		// Sync never starts while locked and stops at the next step when the lock
		// comes on, per decision 15.
		mailSync.configureMailSync({ mailDir: mailDir(), isPaused: () => lock.isLocked() });
		configureMailboxSource(openImapSource);
		configureMailboxWriter(openImapWriter);
		configureMailTransport(smtpTransport, imapSentAppender);
		// The sender pauses with the lock too, and renders a PDF for an attached
		// document through the same path the documents screen uses.
		mailSend.configureMailSend({
			isPaused: () => lock.isLocked(),
			renderDocumentPdf: async (id) => (await documentActions.renderPdf(id)).pdfPath,
			onSent: (accountId) => {
				void mailSync.syncAccount(accountId).catch(() => undefined);
			},
		});
		// safeStorage is usable now that the app is ready, and not before.
		configureCredentialStore(safeStorageCredentialStore);

		splashStep("Opening the database");
		const db = openDb(databasePath());

		splashStep("Applying migrations");
		const migrations = runMigrations(getConnection());
		if (migrations.applied.length > 0) {
			console.log(`Applied ${migrations.applied.length} migration(s):`, migrations.applied);
		}

		// Reference data is seeded before the window exists, so the first screen is
		// never a set of empty dropdowns. Idempotent, so this is cheap on every
		// launch after the first.
		splashStep("Preparing reference data");
		const seeded = await ensureSeeded(db);
		if (seeded.setsCreated || seeded.itemsCreated || seeded.itemsUpdated) {
			console.log(
				`Seed v${seeded.fromVersion} -> v${seeded.toVersion}: ` +
					`${seeded.setsCreated} set(s), ${seeded.itemsCreated} new item(s), ` +
					`${seeded.itemsUpdated} updated`,
			);
		}

		const templateSeed = await ensureTemplatesSeeded(db);
		if (templateSeed.created || templateSeed.updated) {
			console.log(
				`Templates: ${templateSeed.created} created, ${templateSeed.updated} updated`,
			);
		}

		const mailTemplateSeed = await ensureMailTemplatesSeeded(db);
		if (mailTemplateSeed.created || mailTemplateSeed.updated) {
			console.log(
				`Mail templates: ${mailTemplateSeed.created} created, ${mailTemplateSeed.updated} updated`,
			);
		}

		const reminderSeed = await ensureRemindersSeeded(db);
		if (reminderSeed.created) {
			console.log(`Reminders: ${reminderSeed.created} created`);
		}

		// Restoring a backup replaces the live file, which cannot happen while the
		// connection holds it open. The service asks for the close rather than
		// importing app lifecycle code itself.
		setCloseHook(() => closeDb());

		lock.start(await settings.getLock());

		splashStep("Starting services");
		registerAllIpc(userDataDir());

		// The agent surface comes up after IPC, because the gate it enforces is
		// answered over IPC, and after the lock, because every tool checks it.
		startAgentSurface({ userDataDir: userDataDir(), instanceKey: databasePath() });

		// Writing Juno into the agent clients on this machine needs the same
		// connection details the settings screen prints, so it is given the same
		// builder rather than working them out a second time.
		configureAgentInstall({
			status: () => mcpStatus(userDataDir()),
			home: homedir(),
			platform: process.platform,
		});

		// In development only the mail host is served; the window comes from Vite.
		registerAppScheme(isDev ? null : join(app.getAppPath(), "dist"));

		// Installed on the session, so it covers the settings window too. It has
		// to happen before the first window loads anything.
		installSessionPolicy(isDev);

		const window = openMainWindow(isDev);
		// Not on create: a window that exists but has not painted is a grey
		// rectangle, which is the exact gap the splash is covering.
		window.once("ready-to-show", () => closeSplash());

		// One summary a day, never one per reminder. See services/notifications.ts.
		if (!process.env.JUNO_SMOKE) {
			notifications.start();
			mailSync.startScheduler();
			mailSend.startScheduler();
			// An automation is exactly the unattended case the lock pauses, so
			// the scheduler asks before every tick.
			startAutomationScheduler(() => lock.isLocked());
		}

		// Outside the smoke guard, and with no isDev check, because it decides
		// both for itself. An unpackaged run has no release to compare against,
		// so it loads the stored preference for the settings window to draw and
		// schedules nothing.
		void startUpdates();

		// Lets `npm run smoke` prove the real application boots, paints and reaches
		// its database, rather than proving only that it compiles.
		if (process.env.JUNO_SMOKE) {
			// Electron 41 passes a single event object here. The old positional
			// signature still fires but logs a deprecation warning on every message.
			window.webContents.on("console-message", (event) => {
				if (event.level === "warning" || event.level === "error") {
					console.error(`renderer: ${event.message}`);
				}
			});
			window.webContents.once("did-finish-load", () => {
				setTimeout(() => {
					void (async () => {
						// Drives the real preload bridge, so this exercises IPC, the services
						// and the database exactly as a person clicking would. Verifying the
						// interface against a mock would prove nothing about any of them.
						if (process.env.JUNO_SMOKE_DEMO) {
							// No server in a smoke run: the sync reads from a mailbox in memory.
							const { openSmokeMailbox, smokeTransport, smokeAppender } = await import("./main/smoke-mailbox");
							configureMailboxSource(openSmokeMailbox);
							configureMailTransport(smokeTransport, smokeAppender);

							const created = await window.webContents.executeJavaScript(`(async () => {
								const b = window.juno;
								const statuses = await b.reference.getSet("client_status");
								const active = statuses.items.find((i) => i.key === "active") ?? statuses.items[0];
								const lead = statuses.items.find((i) => i.key === "lead") ?? statuses.items[0];
								const made = [];
								for (const c of [
									{ name: "obet", city: "Gent", email: "hallo@obet.be", statusId: active.id },
									{ name: "bodhi", city: "Brugge", email: "info@bodhi.be", statusId: active.id },
									{ name: "noir", city: "Antwerpen", statusId: active.id },
									{ name: "hyge", city: "Leuven", statusId: lead.id },
								]) {
									const client = await b.clients.create({ name: c.name, statusId: c.statusId });
									if (c.email) await b.clientEmails.create({ clientId: client.id, email: c.email });
									await b.clientAddresses.create({ clientId: client.id, addressLine1: "Kerkstraat 1", city: c.city });
									made.push(client);
								}
								await b.contacts.create({ clientId: made[0].id, name: "Laura", role: "Zaakvoerder", email: "laura@obet.be", isPrimary: true });
								const ps = await b.reference.getSet("project_status");
								const running = ps.items.find((i) => i.key === "active") ?? ps.items[0];
								await b.projects.create({ clientId: made[0].id, name: "Ontwikkelovereenkomst site", statusId: running.id, dueOn: "2026-11-14", agreedValueCents: 210000 });
								await b.projects.create({ clientId: made[1].id, name: "Project scope", statusId: running.id, dueOn: "2026-10-03", agreedValueCents: 125000 });
								// Phase 1: generate a document through the same bridge the
								// interface uses, so the smoke run covers it too.
								const tpl = (await b.templates.list()).find((t) => t.key === "development_agreement");
								const gen = await b.documents.generate({
									clientId: made[0].id, templateId: tpl.id, projectId: (await b.projects.list({ clientId: made[0].id }))[0]?.id ?? null,
								});
								// Generating writes the PDF now, so this call is only here to
								// prove the explicit path still works. What generating produced is
								// checked from the main process below, where the file is reachable.
								if (gen.pdfError !== null) throw new Error("Smoke: generating did not write a PDF, " + gen.pdfError);
								if (!gen.document.pdfPath) throw new Error("Smoke: the generated document has no PDF path");
								await b.documents.renderPdf(gen.document.id);

								// Phase 2: a few reminders across the buckets, plus a delivered
								// project so a suggestion appears.
								const iso = (offset) => {
									const d = new Date();
									d.setDate(d.getDate() + offset);
									return d.toISOString().slice(0, 10);
								};
								await b.reminders.create({ title: "Chase the noir deposit", dueOn: iso(-4), category: "payment", clientId: made[2].id });
								await b.reminders.create({ title: "Send hyge the proposal", dueOn: iso(0), category: "other", clientId: made[3].id });
								await b.reminders.create({ title: "Renew the hosting for bodhi", dueOn: iso(5), category: "renewal", pattern: "years", interval: 1, leadDays: 30, clientId: made[1].id });
								await b.settings.setAccountingTool({ name: "the accounting tool", url: "https://example.invalid" });
								const ps2 = await b.reference.getSet("project_status");
								const delivered = ps2.items.find((i) => i.key === "delivered");
								const bodhiProjects = await b.projects.list({ clientId: made[1].id });
								if (delivered && bodhiProjects[0]) {
									await b.projects.update(bodhiProjects[0].id, { statusId: delivered.id });
								}

								// Phase 3: an account through the bridge, then a sync against the
								// in-memory mailbox the main process swapped in above. This is
								// what exercises the credential store, the scheme host and the
								// reader's frame policy.
								await b.settings.setOwner({ businessName: "Juno", firstName: "Nathan", lastName: "Peeters", city: "Gent", vatNumber: "BE0123456789", establishmentNumber: "2123456789" });
								// Two addresses and a number, so the lists under Your business are
								// photographed with something in them. The second one is the case
								// the lists exist for: an address that is kept and never read.
								await b.settings.addOwnerEmail({ email: "hallo@juno.test", label: "general" });
								await b.settings.addOwnerEmail({ email: "nathan@vorigedomein.be", label: "old domain, forwards nowhere" });
								await b.settings.addOwnerPhone({ phone: "+32 470 00 00 00", label: "gsm" });
								const mailAccount = await b.mail.accounts.create({ email: "hallo@juno.test", label: "Juno", imapHost: "imap.juno.test", smtpHost: "smtp.juno.test", password: "smoke" });
								const synced = await b.mail.sync.run();
								if (synced.some((s) => s.phase !== "done")) throw new Error("Smoke: mail sync did not finish: " + JSON.stringify(synced));

								// Phase 4: a cover mail from a template with the document attached,
								// sent by a person, and a second one an agent would have to wait on.
								const coverTemplate = (await b.mail.templates.list()).find((t) => t.key === "contract_cover");
								const rendered = await b.mail.templates.render({ templateId: coverTemplate.id, clientId: made[0].id, extras: { title: "de ontwikkelovereenkomst" } });
								const draft = await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: "Laura", address: "laura@obet.be" }], subject: rendered.subject,
									bodyText: rendered.bodyText, bodyHtml: rendered.bodyHtml, clientId: made[0].id, templateId: coverTemplate.id,
									documentIds: [gen.document.id],
								});
								await b.mail.outbox.send(draft.id);
								await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: null, address: "info@noir.be" }], subject: "Even navragen",
									bodyText: "Dag,\\n\\nIs de offerte goed ontvangen?\\n\\nGroeten", clientId: made[2].id,
								});

								// Phase 5: a weekly call anchored to this week's Tuesday, one
								// occurrence moved, an all-day offsite, and the range read back
								// through the same bridge the grid uses.
								const monday = new Date();
								monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
								const tuesday = new Date(monday); tuesday.setDate(monday.getDate() + 1);
								const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
								const call = await b.calendar.create({
									title: "Weekly call with obet", startLocal: ymd(tuesday) + "T10:00", endLocal: ymd(tuesday) + "T10:30",
									rrule: "FREQ=WEEKLY;BYDAY=TU", clientId: made[0].id, location: "Video",
								});
								const nextTuesday = new Date(tuesday); nextTuesday.setDate(tuesday.getDate() + 7);
								const thursday = new Date(tuesday); thursday.setDate(tuesday.getDate() + 9);
								await b.calendar.update(call.id, { startLocal: ymd(thursday) + "T14:00" }, { scope: "this", occurrenceStartLocal: ymd(nextTuesday) + "T10:00:00" });
								const wednesday = new Date(monday); wednesday.setDate(monday.getDate() + 2);
								const friday = new Date(monday); friday.setDate(monday.getDate() + 5);
								await b.calendar.create({ title: "Offsite, bodhi", startLocal: ymd(wednesday), endLocal: ymd(friday), allDay: true, clientId: made[1].id });
								await b.calendar.create({ title: "Review proposal", startLocal: ymd(wednesday) + "T09:30", endLocal: ymd(wednesday) + "T11:00", clientId: made[3].id });
								const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
								const onGrid = await b.calendar.list({ from: ymd(monday), to: ymd(sunday), includeReminders: true, includeDeadlines: true });
								if (onGrid.filter((i) => i.kind === "event").length !== 3) throw new Error("Smoke: expected three events this week, got " + JSON.stringify(onGrid));

								// Phase 6: an automation whose second step needs approval. The
								// agent's own call is made from the main process below, because
								// that is where a real one arrives.
								await b.automations.create({
									name: "Morning check",
									description: "The day, then something that needs a person.",
									steps: [
										{ tool: "briefing.today", args: {} },
										{ tool: "reminders.create", args: { title: "Ask the accountant about the quarter", due_on: iso(3) } },
									],
								});

								// Phase 7: a project that is not for a client, which is the case
								// the nullable client exists for, with somewhere to go and
								// something to start. The files are added from the main process
								// below: adding one opens a picker, and a picker has nobody to
								// answer it here.
								const own = await b.projects.create({
									name: "Juno", statusId: running.id,
									description: "The back office this is.",
								});
								await b.projects.links.create({ projectId: own.id, label: "Repository", target: "https://github.com/example/juno" });
								await b.projects.links.create({ projectId: own.id, label: "Designs", target: "https://figma.com/file/example" });
								await b.projects.commands.create({ projectId: own.id, label: "Dev server", command: "npm run dev" });
								await b.projects.commands.create({ projectId: own.id, label: "Database", command: "docker compose up -d", kind: "docker" });

								return { clients: (await b.clients.list()).length, projectId: own.id };
							})()`) as { clients: number; projectId: string };
							console.log(`SMOKE_DEMO clients=${created.clients}`);

							// Two files on the project, added through the service rather than
							// the bridge: the bridge's only way in is a file picker, on purpose
							// (.claude/rules/security.md section 2, the renderer never names a
							// path). The icon is a real PNG, so the thumbnail path and the
							// app://asset origin are exercised with bytes that decode.
							{
								const { existsSync } = await import("node:fs");
								const projectAssets = await import("./main/services/project-assets");
								const projectsService = await import("./main/services/projects");
								const icon = join(app.getAppPath(), "build", "icon.png");
								if (existsSync(icon)) {
									const cover = await projectAssets.add({ projectId: created.projectId, sourcePath: icon });
									await projectAssets.add({ projectId: created.projectId, sourcePath: icon, storage: "linked" });
									await projectsService.setCover(created.projectId, cover.id);
									const where = await projectsService.storage(created.projectId);
									if (where.fileCount !== 1) {
										throw new Error(`Smoke: the project folder holds ${where.fileCount} files, not the one managed copy`);
									}
									console.log(`SMOKE_DEMO project files=${where.fileCount} at=${where.mode}`);
								}
							}

							// An agent call goes through the same host the socket calls, so the
							// smoke exercises the real gate rather than a stand-in. Nothing may
							// happen until a person approves it.
							const { callTool } = await import("./main/mcp");
							const agentActions = await import("./main/services/agent-actions");
							const automationService = await import("./main/services/automations");
							const clientService = await import("./main/services/clients");

							const before = (await clientService.list()).length;
							const parked = (await callTool("clients.create", { name: "parked-by-agent" }, { source: "mcp" })) as {
								status?: string;
							};
							if (parked.status !== "pending") {
								throw new Error(`Smoke: clients.create did not park: ${JSON.stringify(parked)}`);
							}
							if ((await clientService.list()).length !== before) {
								throw new Error("Smoke: a parked call created a client anyway");
							}

							// The automation stops on the step that needs a person, and the
							// step after it never runs.
							const [automation] = await automationService.list();
							const runResult = await automationService.run(automation!.id, "manual");
							if (runResult.status !== "waiting") {
								throw new Error(`Smoke: the run did not wait: ${JSON.stringify(runResult)}`);
							}

							const waiting = await agentActions.list({ states: ["pending"] });
							if (waiting.length !== 2) {
								throw new Error(`Smoke: expected two requests waiting, got ${waiting.length}`);
							}
							console.log(`SMOKE_DEMO agent pending=${waiting.length}`);

							// The bridge, for real: a child process speaking MCP over stdio,
							// exactly as an agent's client would start it. This is the only
							// check that covers the socket, the token and the wire.
							await new Promise<void>((resolve, reject) => {
								void (async () => {
									const { spawn } = await import("node:child_process");
									const bridge = spawn(
										process.execPath,
										[join(app.getAppPath(), "scripts", "mcp-bridge.mjs"), "--user-data-dir", userDataDir()],
										{ env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"] },
									);
									let out = "";
									let stderr = "";
									const timer = setTimeout(() => {
										bridge.kill();
										reject(new Error(`Smoke: the bridge did not answer. ${stderr}`));
									}, 20_000);
									const send = (message: unknown) => bridge.stdin.write(`${JSON.stringify(message)}\n`);

									bridge.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
									bridge.stdout.on("data", (chunk: Buffer) => {
										out += chunk.toString();
										let index = out.indexOf("\n");
										while (index !== -1) {
											const line = out.slice(0, index);
											out = out.slice(index + 1);
											index = out.indexOf("\n");
											if (!line.trim()) continue;
											const message = JSON.parse(line) as {
												id?: number;
												result?: { tools?: unknown[]; content?: { text: string }[]; isError?: boolean };
											};
											if (message.id === 1) {
												send({ jsonrpc: "2.0", method: "notifications/initialized" });
												send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
											} else if (message.id === 2) {
												const tools = message.result?.tools ?? [];
												if (tools.length < 90) {
													clearTimeout(timer);
													bridge.kill();
													reject(new Error(`Smoke: the bridge listed ${tools.length} tools`));
													return;
												}
												console.log(`SMOKE_DEMO bridge tools=${tools.length}`);
												send({
													jsonrpc: "2.0",
													id: 3,
													method: "tools/call",
													params: { name: "briefing.today", arguments: {} },
												});
											} else if (message.id === 3) {
												clearTimeout(timer);
												bridge.kill();
												const text = message.result?.content?.[0]?.text ?? "";
												if (message.result?.isError || !text.includes("headline")) {
													reject(new Error(`Smoke: the bridge call failed: ${text}`));
													return;
												}
												console.log(`SMOKE_DEMO bridge briefing=ok`);
												resolve();
											}
										}
									});

									send({
										jsonrpc: "2.0",
										id: 1,
										method: "initialize",
										params: {
											protocolVersion: "2024-11-05",
											capabilities: {},
											clientInfo: { name: "smoke", version: "1" },
										},
									});
								})();
							});
							// The sender is not scheduled in a smoke run, so it is asked directly,
							// and the row has to come out the other side as sent.
							const sentCount = await mailSend.processQueue();
							const outboxRows = await (await import("./main/services/mail-outbox")).list({ states: ["sent"] });
							if (sentCount !== 1 || outboxRows.length !== 1 || outboxRows[0]!.attachments.length !== 1) {
								throw new Error(`Smoke: the outbox did not send the cover mail: ${JSON.stringify(outboxRows)}`);
							}
							console.log(`SMOKE_DEMO outbox sent=${outboxRows[0]!.messageId}`);

							// printToPDF on a window that has not finished loading produces a
							// blank page and does not error, so the bytes are what has to be
							// checked, not the path. A blank A4 is about a kilobyte; a rendered
							// contract is several.
							{
								const { statSync, readFileSync: readPdfBytes } = await import("node:fs");
								const generated = (await (await import("./main/services/documents")).list({})).find(
									(row) => row.sourceKind === "generated" && row.pdfPath !== null,
								);
								if (!generated?.pdfPath) throw new Error("Smoke: no generated document has a PDF");
								const size = statSync(generated.pdfPath).size;
								if (size < 2000) {
									throw new Error(`Smoke: the generated PDF is ${size} bytes, which is a blank page`);
								}
								const head = readPdfBytes(generated.pdfPath).subarray(0, 5).toString("latin1");
								if (head !== "%PDF-") {
									throw new Error(`Smoke: the generated file starts with ${head}, not a PDF header`);
								}
								console.log(`SMOKE_DEMO generated pdf=${size}`);
							}
							window.webContents.reload();
							await new Promise((r) => {
								window.webContents.once("did-finish-load", () => setTimeout(r, 900));
							});
							// Selects a row, so the screenshot covers the detail pane as well as
							// the list. Clicking the real button also proves the row is reachable.
							await window.webContents.executeJavaScript(
								`(() => { const b = [...document.querySelectorAll("tbody button")]
									.find((el) => el.textContent.trim() === "obet");
									if (b) b.click(); return Boolean(b); })()`,
							);
							await new Promise((r) => setTimeout(r, 900));

						}

						// A screenshot is the only part of this that can catch a window that
						// loads without error and still renders nothing.
						const shotDir = process.env.JUNO_SMOKE_SHOT;
						if (shotDir) {
							const { writeFileSync, mkdirSync } = await import("node:fs");
							const { join: joinPath } = await import("node:path");
							mkdirSync(shotDir, { recursive: true });

							/**
							 * Captures the frame that is on screen now rather than the one
							 * before it, as far as that is possible at all.
							 *
							 * `capturePage` resolves against whatever the compositor last
							 * produced, so a capture taken straight after a change hands back
							 * the previous frame. Waiting for two animation frames puts the
							 * change through layout, paint and composite first, and that is
							 * what this does.
							 *
							 * It is not a guarantee, and the difference matters. A window that
							 * is occluded or minimised is not composited at all, so no frame
							 * is produced and no wait can conjure one: a run under a window
							 * somebody clicked in front of writes a folder where whole runs of
							 * images are identical, and nothing in the run says so. The wait
							 * is raced against a timer for exactly that case, because a bare
							 * await on an animation frame that will never arrive does not
							 * resolve late, it hangs the run until the outer timeout kills it
							 * with no line saying where.
							 *
							 * The smoke script counts identical images afterwards and says so.
							 * Read that line before using any of these as evidence.
							 */
							const capture = async (contents: Electron.WebContents) => {
								await contents.executeJavaScript(
									`Promise.race([
										new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
										new Promise((r) => setTimeout(() => r(null), 500)),
									])`,
								);
								return contents.capturePage();
							};
							// A throwaway user-data directory is a genuinely first install, so
							// the setup window opens in front of the application (decision 34).
							// Photograph it, then finish it the way a person would: if the flow
							// ever stops completing, the walk below fails rather than the app
							// silently trapping every new install behind a modal with no way out.
							{
								const { getSetupWindow } = await import("./main/windows");
								let setup = getSetupWindow();
								for (let wait = 0; wait < 40 && !setup; wait++) {
									await new Promise((r) => setTimeout(r, 250));
									setup = getSetupWindow();
								}
								if (!setup) throw new Error("Smoke: a first run did not open the setup window");
								const flow = setup.webContents;

								const setupPresent = await flow.executeJavaScript(
									`(() => {
										const buttons = [...document.querySelectorAll("button")].map((el) => el.textContent.trim());
										if (!buttons.includes("Set up Juno")) return "no first step";
										// Setup cannot be skipped as a whole any more. A way past it
										// reappearing here is the regression this asserts against.
										return buttons.includes("Skip setup") ? "still offers a skip" : "ok";
									})()`,
								) as string;

								if (setupPresent !== "ok") throw new Error(`Smoke: the setup window ${setupPresent}`);

								for (const theme of ["light", "dark"] as const) {
									nativeTheme.themeSource = theme;
									await flow.executeJavaScript(
										`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
									);
									await new Promise((r) => setTimeout(r, 400));
									const image = await capture(flow);
									writeFileSync(joinPath(shotDir, `setup-welcome-${theme}.png`), image.toPNG());
								}
								// Back to light, so the screens photographed after this start from
								// the same place the loop below expects.
								nativeTheme.themeSource = "light";
								await flow.executeJavaScript(`document.documentElement.setAttribute("data-theme", "light")`);

								// Walks the steps rather than skipping them, so each one is
								// photographed and each one's own controls are proven to advance.
								const steps = [
									{ id: "you", label: "Your name" },
									{ id: "business", label: "Your business" },
									{ id: "appearance", label: "Appearance" },
									{ id: "lock", label: "Lock" },
									{ id: "mail", label: "Mail" },
								];
								await flow.executeJavaScript(
									`(() => { [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Set up Juno").click(); })()`,
								);
								for (const { id: step, label } of steps) {
									await new Promise((r) => setTimeout(r, 500));
									const image = await capture(flow);
									writeFileSync(joinPath(shotDir, `setup-${step}.png`), image.toPNG());
									// The name and the business name are the two answers setup
									// insists on, so a run against an empty profile has to type
									// them. Filling only what is empty means the demo run, which
									// seeded a profile already, still walks the same path.
									const advanced = await flow.executeJavaScript(
										`(async () => {
											const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											let typed = false;
											for (const input of document.querySelectorAll("input[required]")) {
												if (input.value.trim().length > 0) continue;
												setValue.call(input, "Smoke");
												input.dispatchEvent(new Event("input", { bubbles: true }));
												typed = true;
											}
											if (typed) await new Promise((r) => setTimeout(r, 200));
											const next = [...document.querySelectorAll("button")]
												.find((el) => ["Continue", "Skip for now", "Not now"].includes(el.textContent.trim()));
											if (!next) return false;
											next.click();
											return true;
										})()`,
									) as boolean;
									if (!advanced) throw new Error(`Smoke: setup step ${step} had nothing to continue with`);
									// Pressing Continue on a step that refuses to be passed leaves
									// the rail where it was, which is the failure worth catching:
									// a required field nobody can satisfy is a dead end for every
									// new install, and it looks like a click that did not land.
									await new Promise((r) => setTimeout(r, 400));
									const now = await flow.executeJavaScript(
										`(document.querySelector("[aria-current=step]")?.getAttribute("aria-label") ?? "")`,
									) as string;
									if (now === label) throw new Error(`Smoke: setup would not move past ${label}`);
								}

								await new Promise((r) => setTimeout(r, 500));
								const done = await capture(flow);
								writeFileSync(joinPath(shotDir, `setup-done.png`), done.toPNG());

								// Takes the tour rather than skipping straight in, so the
								// walkthrough is proven live at least once per run: it is the one
								// screen this file otherwise has no way to reach, since it only ever
								// offers itself on a first run or an unseen upgrade.
								const startedTour = await flow.executeJavaScript(
									`(() => {
										const tour = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Take the walkthrough");
										if (!tour) return false;
										tour.click();
										return true;
									})()`,
								) as boolean;
								if (!startedTour) throw new Error("Smoke: the last setup step had no way into the walkthrough");

								// The window closes itself on the way out, and the main window is
								// told so it can start the tour. Both have to happen, so wait for
								// the first before asking about the second.
								for (let wait = 0; wait < 40 && getSetupWindow(); wait++) {
									await new Promise((r) => setTimeout(r, 250));
								}
								if (getSetupWindow()) throw new Error("Smoke: the setup window stayed open after it finished");

								await new Promise((r) => setTimeout(r, 700));
								const cardTitle = () =>
									window.webContents.executeJavaScript(
										`(() => { const c = document.querySelector("[role=dialog][aria-modal=true]"); return c ? (c.querySelector("h2")?.textContent.trim() ?? "") : ""; })()`,
									) as Promise<string>;

								const firstStop = await cardTitle();
								if (firstStop !== "Today") {
									throw new Error(`Smoke: the walkthrough opened on "${firstStop}", not Today`);
								}

								// Two stops forward, checking the card actually changed each time
								// rather than only that a click landed: a tour stuck on the first
								// card would still answer every one of these clicks.
								for (const expected of ["Clients", "Documents"]) {
									const advanced = await window.webContents.executeJavaScript(
										`(() => {
											const card = document.querySelector("[role=dialog][aria-modal=true]");
											const next = card ? [...card.querySelectorAll("button")].find((el) => el.textContent.trim() === "Next") : null;
											if (!next) return false;
											next.click();
											return true;
										})()`,
									) as boolean;
									if (!advanced) throw new Error("Smoke: the walkthrough had no way to step forward");
									await new Promise((r) => setTimeout(r, 500));
									const title = await cardTitle();
									if (title !== expected) {
										throw new Error(`Smoke: the walkthrough showed "${title}" where "${expected}" was expected`);
									}
								}

								const walkthroughImage = await capture(window.webContents);
								writeFileSync(joinPath(shotDir, `walkthrough.png`), walkthroughImage.toPNG());

								await window.webContents.executeJavaScript(
									`(() => {
										const card = document.querySelector("[role=dialog][aria-modal=true]");
										const close = card ? [...card.querySelectorAll("button")].find((el) => el.textContent.trim() === "Close the walkthrough") : null;
										if (close) close.click();
									})()`,
								);
								await new Promise((r) => setTimeout(r, 500));

								const shellUp = await window.webContents.executeJavaScript(
									`Boolean(document.querySelector("nav button[data-nav]"))`,
								) as boolean;
								if (!shellUp) throw new Error("Smoke: closing the walkthrough did not reveal the application");
							}

							const screens = process.env.JUNO_SMOKE_DEMO ? ["Today", "Reminders", "Clients", "Client record", "Projects", "Projects as a list", "Project record", "Calendar", "Week", "Event form", "Mail", "Drafts", "Documents", "Agent", "Connection", "Mail templates", "Document templates"] : ["Clients"];
							for (const screen of screens) {
								// A dialog left open by the previous step would sit over this one.
								await window.webContents.executeJavaScript(
									`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
								);
								// Drafts is a view inside Mail; Week and the event form live inside
								// Calendar. None of the three is a sidebar entry.
								const sidebarEntry =
									screen === "Client record"
										? "Clients"
										: screen === "Project record" || screen === "Projects as a list"
											? "Projects"
											: screen === "Drafts"
												? "Mail"
												: screen === "Week" || screen === "Event form"
													? "Calendar"
													: screen === "Connection"
														? "Agent"
														: screen;
								// Matched on data-nav, never on the label. A collapsed sidebar
								// renders icons only, and a display narrower than 1100px puts it
								// in exactly that state, which is what a CI runner gives you.
								// Two of these do not follow the label: the mail templates entry
								// is still keyed `templates`, and the document one is hyphenated.
								const navId =
									sidebarEntry === "Mail templates"
										? "templates"
										: sidebarEntry === "Document templates"
											? "document-templates"
											: sidebarEntry.toLowerCase();
								const click = () =>
									window.webContents.executeJavaScript(
										`(() => { const b = document.querySelector("nav button[data-nav=" + JSON.stringify(${JSON.stringify(navId)}) + "]");
											if (b) b.click(); return Boolean(b); })()`,
									) as Promise<boolean>;

								// Reminders has no sidebar row: it is reached from the bell in
								// the title bar, which is also the only place that shows the count.
								// Walking it the way a person does is what proves that path works.
								if (screen === "Reminders") {
									const reached = await window.webContents.executeJavaScript(
										`(async () => {
											const bell = document.querySelector("button[aria-label='Show reminders']");
											if (!bell) return "no reminders button";
											bell.click();
											await new Promise((r) => setTimeout(r, 400));
											const all = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "View all");
											if (!all) return "no view all";
											all.click();
											await new Promise((r) => setTimeout(r, 600));
											return "ok";
										})()`,
									) as string;
									if (reached !== "ok") throw new Error(`Smoke: reminders ${reached}`);
								}

								let clicked = screen === "Reminders" ? true : await click();
								if (!clicked) {
									// Below 760px the sidebar is a drawer and is not in the document
									// at all. The toggle in the title bar is what puts it there.
									await window.webContents.executeJavaScript(
										`(() => { const t = document.querySelector("[data-sidebar-toggle]"); if (t) t.click(); })()`,
									);
									await new Promise((r) => setTimeout(r, 300));
									clicked = await click();
								}
								if (!clicked) throw new Error(`Smoke: no sidebar entry for ${screen}`);
								await new Promise((r) => setTimeout(r, 800));
								if (screen === "Agent") {
									// The requests tab is the default, and the pending request from
									// the agent call above has to be on it with its arguments.
									const shown = await window.webContents.executeJavaScript(
										`(() => {
											const text = document.querySelector("main").textContent;
											if (!text.includes("Waiting for you")) return "no waiting section";
											if (!text.includes("parked-by-agent")) return "the request is not shown";
											const approve = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Approve");
											return approve ? "ok" : "no approve button";
										})()`,
									);
									if (shown !== "ok") throw new Error(`Smoke: agent requests ${shown}`);
								}
								if (screen === "Projects") {
									// The cards, with the cover the seed set. A card with no image
									// would still draw, so this looks for the img rather than for
									// the tile: the thumbnail is served over app://asset, and a
									// policy that blocks it is exactly the failure worth catching.
									const grid = await window.webContents.executeJavaScript(
										`(async () => {
											await new Promise((r) => setTimeout(r, 400));
											const main = document.querySelector("main");
											if (!main.querySelector("[role=group][aria-label=Layout]")) return "no layout switcher";
											const cards = main.querySelectorAll("ul > li > button");
											if (cards.length < 3) return "only " + cards.length + " cards";
											const image = main.querySelector("ul img");
											if (!image) return "no cover image on any card";
											if (!image.getAttribute("src").startsWith("app://asset/")) return "the cover is not served from the asset origin";
											if (!image.complete || image.naturalWidth === 0) return "the cover did not decode";
											if (!main.textContent.includes("Your own work")) return "the project with no client is not shown";
											return "ok";
										})()`,
									) as string;
									if (grid !== "ok") throw new Error(`Smoke: projects ${grid}`);
								}
								if (screen === "Projects as a list") {
									// The other two layouts, which is the whole point of the
									// switcher. Going back to cards afterwards leaves the stored
									// preference where the record shot below expects it.
									const switched = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const main = document.querySelector("main");
											const group = main.querySelector("[role=group][aria-label=Layout]");
											if (!group) return "no layout switcher";
											const button = (label) => [...group.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === label);
											if (!button("List")) return "no list layout";
											button("List").click();
											await wait(500);
											if (!document.querySelector("main table tbody tr")) return "the list layout drew no rows";
											if (document.querySelector("main table img")) return "the list layout still draws thumbnails";
											button("Rows").click();
											await wait(500);
											if (!document.querySelector("main table img")) return "the rows layout draws no thumbnails";
											return "ok";
										})()`,
									) as string;
									if (switched !== "ok") throw new Error(`Smoke: project layouts ${switched}`);
								}
								if (screen === "Project record") {
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const group = document.querySelector("main [role=group][aria-label=Layout]");
											const cards = group ? [...group.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === "Cards") : null;
											if (cards) { cards.click(); await wait(400); }
											const own = [...document.querySelectorAll("main ul > li > button")].find((el) => el.textContent.includes("Juno"));
											if (!own) return "no card for the project with no client";
											own.click();
											await wait(800);
											const main = document.querySelector("main");
											if (!main.textContent.includes("Repository")) return "the links are not shown";
											if (!main.textContent.includes("npm run dev")) return "the commands are not shown";
											const start = [...main.querySelectorAll("button")].find((el) => el.textContent.trim() === "Start");
											if (!start) return "no start button";
											const files = main.textContent.includes("Files");
											if (!files) return "no files section";
											// The three dots say where the files are kept, which is the
											// one answer this screen exists to give.
											const more = main.querySelector("button[aria-label='More project actions']");
											if (!more) return "no actions menu";
											more.click();
											await wait(300);
											const where = [...document.querySelectorAll("[role=menuitem]")].find((el) => el.textContent.trim() === "Where the files are kept");
											if (!where) return "the menu does not say where the files are";
											where.click();
											await wait(600);
											const dialog = document.querySelector("[role=dialog]");
											if (!dialog) return "no storage dialog";
											if (!dialog.textContent.includes("Choose a folder")) return "the storage dialog offers no way to move it";
											return "ok";
										})()`,
									) as string;
									if (opened !== "ok") throw new Error(`Smoke: project record ${opened}`);
								}
								if (screen === "Client record") {
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const row = document.querySelector("main table tbody tr button");
											if (!row) return "no client rows";
											row.click();
											await new Promise((r) => setTimeout(r, 700));
											const main = document.querySelector("main");
											if (!main.querySelector("[role=tablist]")) return "no tabs";
											const timeline = [...main.querySelectorAll("[role=tab]")].find((el) => el.textContent.trim().startsWith("Timeline"));
											if (!timeline) return "no timeline tab";
											timeline.click();
											await new Promise((r) => setTimeout(r, 700));
											return "ok";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: client record ${opened}`);
								}
								if (screen === "Connection") {
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const tab = [...document.querySelectorAll("[role=tab]")].find((el) => el.textContent.trim() === "Connection");
											if (!tab) return "no connection tab";
											tab.click();
											await new Promise((r) => setTimeout(r, 700));
											const main = document.querySelector("main");
											if (!main.textContent.includes("Listening")) return "not listening";
											// The installers are one of two routes and the block of
											// configuration is the other, so both sides of the switch
											// are checked here rather than assuming which one is up.
											if (!main.textContent.includes("Claude Desktop")) return "no client list";
											const manual = [...main.querySelectorAll("button[role=radio]")].find((el) => el.textContent.trim() === "Do it myself");
											if (!manual) return "no manual route";
											manual.click();
											await new Promise((r) => setTimeout(r, 400));
											if (!main.textContent.includes("mcpServers")) return "no configuration block";
											const installers = [...main.querySelectorAll("button[role=radio]")].find((el) => el.textContent.trim() === "Let Juno do it");
											if (installers) installers.click();
											await new Promise((r) => setTimeout(r, 400));
											return "ok";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: agent connection ${opened}`);
								}
								if (screen === "Clients") {
									// A notes field is CodeMirror now, not a textarea, and the only
									// way to know typing into one still reaches the document is to
									// type into one. The client form is the simplest place that has it.
									const noted = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const newClient = document.querySelector("button[aria-label='New client']");
											if (!newClient) return "no new client action";
											newClient.click();
											await wait(500);
											const addNotes = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Add notes");
											if (!addNotes) return "no add notes action";
											addNotes.click();
											await wait(300);
											const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === "Notes");
											if (!label) return "no notes label";
											const content = document.getElementById(label.htmlFor);
											if (!content) return "no notes editor";
											content.focus();
											document.execCommand("insertText", false, "# Smoke run heading with **bold** text");
											await wait(300);
											if (!content.closest(".cm-editor") || !content.classList.contains("cm-content")) {
												return "the notes field is not a CodeMirror editor";
											}
											if (!content.textContent.includes("Smoke run heading") || !content.textContent.includes("bold")) {
												return "the typed text did not land";
											}
											// The whole point of the editor: the markup is visible on the
											// line the cursor is on and hidden everywhere else. Typing a
											// second line moves the cursor off the first, so the hash and
											// the asterisks should stop being in the document at all,
											// because hiding them is a replace decoration rather than a
											// colour. Asserting it here is the only place that would
											// notice the decorations silently stopping.
											document.execCommand("insertText", false, String.fromCharCode(10) + "plain second line");
											await wait(400);
											const shown = content.textContent;
											if (shown.includes("**")) return "the emphasis markers stayed visible off the cursor line";
											if (shown.includes("# Smoke")) return "the heading hash stayed visible off the cursor line";
											if (!shown.includes("Smoke run heading")) return "hiding the markup took the heading text with it";
											return "ok";
										})()`,
									) as string;
									if (noted !== "ok") throw new Error(`Smoke: notes editor ${noted}`);

									const notesImage = await capture(window.webContents);
									writeFileSync(joinPath(shotDir, `notes-editor.png`), notesImage.toPNG());

									// Leaves without saving: the client list this screen is about to
									// be photographed against has to stay exactly the seeded four.
									await window.webContents.executeJavaScript(
										`(() => { const cancel = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Cancel"); if (cancel) cancel.click(); })()`,
									);
									await new Promise((r) => setTimeout(r, 400));
								}
								if (screen === "Mail templates" || screen === "Document templates") {
									// Opens the first template so the preview path runs for real: the
									// list renders, the row opens a preview, and the preview asks the
									// service to fill the template. A typecheck proves none of that,
									// and the preview is where a template screen would throw.
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const row = document.querySelector("main ul li button");
											if (!row) return "no template row";
											row.click();
											await new Promise((r) => setTimeout(r, 900));
											const main = document.querySelector("main");
											if (!main) return "no main";
											const use = [...main.querySelectorAll("button")].find((el) => el.textContent.trim() === "Use");
											const edit = [...main.querySelectorAll("button")].find((el) => el.textContent.trim() === "Edit");
											if (!use || !edit) return "the preview has no use and edit actions";
											if (!main.querySelector("iframe")) return "the preview has no frame";
											return "ok";
										})()`,
									) as string;
									if (opened !== "ok") throw new Error(`Smoke: ${screen} ${opened}`);
								}
								if (screen === "Document templates") {
									// The seeded templates carry no page layout, so the editor opens
									// in its plain-HTML mode first. Starting a layout, dropping a block
									// on the canvas and reading it back is the only thing in this app
									// that proves the page compiler's editor half, rather than only the
									// renderer that turns a finished layout into a PDF.
									const edited = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											await wait(600);
											const start = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Start a page layout");
											if (!start) return "no start-a-page-layout action";
											start.click();
											await wait(400);
											const dialog = document.querySelector("[role=dialog]");
											if (!dialog) return "no confirmation dialog";
											const confirm = [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Start a page layout");
											if (!confirm) return "the confirmation has no way to continue";
											confirm.click();
											await wait(700);
											if (!document.querySelector("button[aria-label^='Page 1']")) return "no page canvas";
											const addParagraph = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Add paragraph");
											if (!addParagraph) return "no insert control";
											addParagraph.click();
											await wait(300);
											if (!document.querySelector("button[aria-label='Paragraph block']")) return "the block did not appear on the canvas";
											return "ok";
										})()`,
									) as string;
									if (edited !== "ok") throw new Error(`Smoke: document template editor ${edited}`);

									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 400));
										const image = await capture(window.webContents);
										writeFileSync(joinPath(shotDir, `document-template-editor-${theme}.png`), image.toPNG());
									}

									// Leaves the block unsaved: the back arrow raises its own discard
									// dialog because the draft now differs from what "Start a page
									// layout" already wrote, and this is that path exercised for real.
									const leftEditor = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const back = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Back");
											if (!back) return "no back action";
											back.click();
											await wait(400);
											const dialog = document.querySelector("[role=dialog]");
											if (dialog) {
												const discard = [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Discard and leave");
												if (!discard) return "no discard action";
												discard.click();
												await wait(500);
											}
											return document.querySelector("main button") ? "ok" : "did not return to the preview";
										})()`,
									) as string;
									if (leftEditor !== "ok") throw new Error(`Smoke: leaving the document template editor ${leftEditor}`);

									// Walks Fill (skipped, the seeded templates ask for nothing extra),
									// Link and Review, stopping short of the generate button.
									const usedDocument = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const use = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Use");
											if (!use) return "no use action";
											use.click();
											await wait(600);
											const clientLabel = [...document.querySelectorAll("label")].find((el) => el.textContent.trim().startsWith("Client"));
											if (!clientLabel) return "no client field";
											const select = document.getElementById(clientLabel.htmlFor);
											if (!select) return "no client select";
											const options = [...select.options].map((o) => o.value).filter(Boolean);
											if (options.length === 0) return "no client to link";
											const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
											setter.call(select, options[0]);
											select.dispatchEvent(new Event("change", { bubbles: true }));
											await wait(200);
											const next = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Next");
											if (!next) return "no next action";
											next.click();
											await wait(900);
											if (!document.querySelector('main iframe[title="Document preview"]')) return "no rendered review";
											return "ok";
										})()`,
									) as string;
									if (usedDocument !== "ok") throw new Error(`Smoke: using a document template ${usedDocument}`);

									const useDocumentImage = await capture(window.webContents);
									writeFileSync(joinPath(shotDir, `use-document-template.png`), useDocumentImage.toPNG());

									// One click undoes Review, landing back on Link; the same control,
									// now reading "Cancel", is what actually leaves the sequence.
									await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const leave = () => {
												const b = [...document.querySelectorAll("button")].find((el) => ["Previous", "Cancel"].includes(el.textContent.trim()));
												if (b) b.click();
												return Boolean(b);
											};
											leave();
											await wait(400);
											leave();
											await wait(400);
										})()`,
									);
								}
								if (screen === "Mail templates") {
									// One document underneath both tabs (docs/editors.md section 2):
									// switching to Code has to show the very text the Visual tab was
									// rendering, not a blank editor or a stale one.
									const edited = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											await wait(700);
											const visual = document.querySelector('[aria-label="Message body"]');
											if (!visual) return "no visual editor";
											const visualText = visual.textContent.trim();
											if (!visualText) return "the visual editor is empty";
											const codeTab = [...document.querySelectorAll("[role=tab]")].find((el) => el.textContent.trim() === "Code");
											if (!codeTab) return "no code tab";
											codeTab.click();
											await wait(400);
											const code = document.querySelector('[aria-label="Body HTML"]');
											if (!code) return "no code editor";
											if (!code.textContent.includes(visualText.slice(0, 20))) return "the code view does not show the same body";
											const visualTab = [...document.querySelectorAll("[role=tab]")].find((el) => el.textContent.trim() === "Visual");
											if (!visualTab) return "no visual tab";
											visualTab.click();
											await wait(400);
											return "ok";
										})()`,
									) as string;
									if (edited !== "ok") throw new Error(`Smoke: mail template editor ${edited}`);

									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 400));
										const image = await capture(window.webContents);
										writeFileSync(joinPath(shotDir, `mail-template-editor-${theme}.png`), image.toPNG());
									}

									// No content was actually typed, so there is nothing this editor
									// guards against losing: Escape leaves straight away, the same way
									// it does everywhere else in this file.
									await window.webContents.executeJavaScript(
										`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 500));

									// No Fill step either: the seeded mail templates ask for nothing
									// beyond a client and a project, so one Next reaches Review.
									const usedMail = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const use = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Use");
											if (!use) return "no use action";
											use.click();
											await wait(600);
											const next = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Next");
											if (!next) return "no next action";
											next.click();
											await wait(900);
											const main = document.querySelector("main");
											if (!main) return "no main";
											const subjectLabel = [...main.querySelectorAll("p")].find((el) => el.textContent.trim() === "Subject");
											if (!subjectLabel) return "no rendered subject";
											const subjectText = subjectLabel.nextElementSibling ? subjectLabel.nextElementSibling.textContent.trim() : "";
											if (!subjectText) return "the subject did not render";
											if (!main.querySelector('iframe[title="Message preview"]')) return "no rendered body";
											return "ok";
										})()`,
									) as string;
									if (usedMail !== "ok") throw new Error(`Smoke: using a mail template ${usedMail}`);

									const useMailImage = await capture(window.webContents);
									writeFileSync(joinPath(shotDir, `use-mail-template.png`), useMailImage.toPNG());

									// Nothing was created yet at this point, so Escape is enough: it
									// exits the sequence rather than stepping back through it.
									await window.webContents.executeJavaScript(
										`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 500));
								}
								if (screen === "Calendar") {
									// Opens a recurring occurrence, asks to edit it, answers the
									// recurrence question, and checks the form came up for the whole
									// series. Proves the detail, the scope dialog and the form chain
									// through the real bridge before the grid is photographed.
									//
									// Three different shapes, and the assertions name each one
									// (decision 30): the detail is a side panel, the recurrence
									// question is the one genuine modal, and the form is a page that
									// replaces the screen. Asserting a dialog for all three is what
									// this check used to do, and it went stale the moment the panel
									// stopped being modal.
									const walked = await window.webContents.executeJavaScript(
										`(async () => {
											const chip = [...document.querySelectorAll("button[draggable=true]")].find((el) => el.textContent.includes("Weekly call"));
											if (!chip) return "no recurring chip";
											chip.click();
											await new Promise((r) => setTimeout(r, 400));
											const detail = document.querySelector("aside[aria-label]");
											if (!detail) return "no side panel";
											if (!detail.textContent.includes("Every week on Tuesday")) return "the side panel does not show the rule";
											const edit = [...detail.querySelectorAll("button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "the side panel has no edit";
											edit.click();
											await new Promise((r) => setTimeout(r, 500));
											const ask = document.querySelector("[role=dialog]");
											if (!ask || !ask.textContent.includes("This and following occurrences")) return "no scope question";
											[...ask.querySelectorAll("button")].find((el) => el.textContent.trim() === "All occurrences").click();
											await new Promise((r) => setTimeout(r, 600));
											const main = document.querySelector("main");
											if (!main || !main.textContent.includes("Edit all occurrences")) return "no series form";
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 400));
											const stillOpen = document.querySelector("main").textContent.includes("Edit all occurrences");
											return stillOpen ? "the form did not close" : "ok";
										})()`,
									);
									if (walked !== "ok") throw new Error(`Smoke: calendar ${walked}`);
								}
								if (screen === "Event form") {
									// Opens the form from a day cell, then switches it to weekly so
									// the recurrence editor is in the picture.
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											// By accessible name, like the week switch above: the view
											// buttons carry a long label and a short one at once.
											const month = document.querySelector("button[aria-label='Month']");
											if (month) month.click();
											await new Promise((r) => setTimeout(r, 400));
											const add = document.querySelector("button[aria-label^='New event on']");
											if (!add) return "no add button";
											add.click();
											await new Promise((r) => setTimeout(r, 600));
											// A form is a page, not a modal (decision 30), so it lives
											// in main rather than behind a dialog role.
											const form = document.querySelector("main");
											if (!form || !form.textContent.includes("New event")) return "no event form";
											// The form is a sequence, and repetition is on the second
											// step ("When"), so the title has to be filled in before
											// the step rail will hand over to it.
											const title = form.querySelector("input[type=text]");
											if (!title) return "no title field";
											const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											input.call(title, "Smoke run");
											title.dispatchEvent(new Event("input", { bubbles: true }));
											await new Promise((r) => setTimeout(r, 200));
											const next = [...form.querySelectorAll("button")].find((el) => el.textContent.trim() === "Next");
											if (!next) return "no next";
											next.click();
											await new Promise((r) => setTimeout(r, 500));
											const repeats = [...form.querySelectorAll("select")].find((el) => [...el.options].some((o) => o.value === "WEEKLY"));
											if (!repeats) return "no repeat select";
											const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
											setter.call(repeats, "WEEKLY");
											repeats.dispatchEvent(new Event("change", { bubbles: true }));
											await new Promise((r) => setTimeout(r, 400));
											return form.querySelector("[role=group][aria-label=Weekdays]") ? "ok" : "no weekday picker";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: event form ${opened}`);
								}
								if (screen === "Week") {
									const switched = await window.webContents.executeJavaScript(
										`(async () => {
											// By accessible name, not by text: the view switch carries a
											// long label and a short one and lets CSS pick, so its text
											// content is "WeekW" at every width.
											const b = document.querySelector("button[aria-label='Week']");
											if (!b) return "no week button";
											b.click();
											await new Promise((r) => setTimeout(r, 600));
											return document.querySelector("[role=button][aria-label]") ? "ok" : "no events drawn";
										})()`,
									);
									if (switched !== "ok") throw new Error(`Smoke: calendar week view ${switched}`);
								}
								if (screen === "Drafts") {
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Drafts"));
											if (!nav) return "no drafts entry";
											nav.click();
											await new Promise((r) => setTimeout(r, 600));
											const row = document.querySelector("ul li button");
											if (!row) return "no rows";
											row.click();
											await new Promise((r) => setTimeout(r, 600));
											return "ok";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: drafts ${opened}`);
								}
								if (screen === "Mail") {
									// The list and the composer, both themes, before a thread takes
									// the pane over. The reader is the shot the mail step used to
									// end on, and it is not the screen anybody spends the day in.
									const shoot = async (name: string) => {
										for (const theme of ["light", "dark"] as const) {
											nativeTheme.themeSource = theme;
											await window.webContents.executeJavaScript(
												`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
											);
											await new Promise((r) => setTimeout(r, 300));
											const shot = await capture(window.webContents);
											writeFileSync(joinPath(shotDir, `${name}-${theme}.png`), shot.toPNG());
										}
									};
									await shoot("mail-list");

									// Ticking a row turns the list into something you file in
									// bulk: the toolbar grows a box, a count and the actions, and
									// the per-row icons step aside. It is a second layout of the
									// same screen, so it gets its own picture.
									const ticked = await window.webContents.executeJavaScript(
										`(async () => {
											const box = document.querySelector("ul li input[type=checkbox]");
											if (!box) return "no row checkbox";
											box.click();
											await new Promise((r) => setTimeout(r, 400));
											// The box itself is always there, so it proves nothing. Its
											// label flips to "Clear selection" only once a row is held.
											const bar = document.querySelector("input[aria-label='Clear selection']");
											return bar ? "ok" : "no selection toolbar";
										})()`,
									);
									if (ticked !== "ok") throw new Error(`Smoke: mail selection ${ticked}`);
									await shoot("mail-selection");
									await window.webContents.executeJavaScript(
										`(() => {
											const box = document.querySelector("ul li input[type=checkbox]");
											if (box) box.click();
										})()`,
									);
									await new Promise((r) => setTimeout(r, 400));

									// The same list serves a folder the user made and the trash,
									// so selection has to work in both. The trash is the one that
									// offers "delete forever" where the others offer the bin.
									for (const [folder, removeLabel] of [
										["Offertes", "Move to trash"],
										["Trash", "Delete forever"],
									] as const) {
										const held = await window.webContents.executeJavaScript(
											`(async () => {
												const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith(${JSON.stringify(folder)}));
												if (!nav) return "no folder";
												nav.click();
												await new Promise((r) => setTimeout(r, 800));
												const box = document.querySelector("ul li input[type=checkbox]");
												if (!box) return "no rows";
												box.click();
												await new Promise((r) => setTimeout(r, 400));
												if (!document.querySelector("input[aria-label='Clear selection']")) return "no selection toolbar";
												if (!document.querySelector("button[aria-label=" + JSON.stringify(${JSON.stringify(removeLabel)}) + "]")) return "no " + ${JSON.stringify(removeLabel)};
												box.click();
												await new Promise((r) => setTimeout(r, 300));
												return "ok";
											})()`,
										);
										if (held !== "ok") throw new Error(`Smoke: selection in ${folder}: ${held}`);
									}
									await window.webContents.executeJavaScript(
										`(() => {
											const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Inbox"));
											if (nav) nav.click();
										})()`,
									);
									await new Promise((r) => setTimeout(r, 800));

									const composed = await window.webContents.executeJavaScript(
										`(async () => {
											// Matched on the label: writing is a plus on the title line
											// now, so there is no text to find it by.
											const open = document.querySelector("button[aria-label='New message']");
											if (!open) return "no new message button";
											open.click();
											await new Promise((r) => setTimeout(r, 700));
											return document.querySelector("input[role=combobox]") ? "ok" : "no composer";
										})()`,
									);
									if (composed !== "ok") throw new Error(`Smoke: compose ${composed}`);
									await shoot("mail-compose");
									// A subject, then Escape, which is the composer's only way
									// out since it became a full-screen form. Typing first is what
									// gives autosave something to write, and the draft it leaves
									// behind is what the Drafts step below has to show.
									const closed = await window.webContents.executeJavaScript(
										`(async () => {
											const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim().startsWith("Subject"));
											const field = label ? document.getElementById(label.htmlFor) : null;
											if (!field) return "no subject field";
											const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
											setValue.call(field, "Smoke draft");
											field.dispatchEvent(new Event("input", { bubbles: true }));
											await new Promise((r) => setTimeout(r, 1500));
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 900));
											return document.querySelector("ul li button") ? "ok" : "the list did not come back";
										})()`,
									);
									if (closed !== "ok") throw new Error(`Smoke: compose close ${closed}`);

									// Opens the newest thread, so the reader and its frame are in
									// the picture, and checks the frame actually loaded a body.
									const mailResponses: { url: string; statusCode: number }[] = [];
									window.webContents.session.webRequest.onCompleted({ urls: ["app://mail/*"] }, (details) => {
										mailResponses.push({ url: details.url, statusCode: details.statusCode });
									});
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const row = document.querySelector("ul li button");
											if (!row) return "no rows";
											row.click();
											await new Promise((r) => setTimeout(r, 1200));
											return document.querySelector("iframe") ? "ok" : "no frame";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: mail reader ${opened}`);
									// A frame the CSP refused would sit on about:blank. One that
									// navigated to the mail origin proves the scheme host answered
									// and the frame-src rule let it through.
									const mailFrame = window.webContents.mainFrame.framesInSubtree.find((f) =>
										f.url.startsWith("app://mail/message/"),
									);
									if (!mailFrame) throw new Error("Smoke: the message frame did not load from app://mail");
									// The frame is sandboxed, so nothing can be asked of its document,
									// which is the point. The request log says whether the scheme
									// host answered it with a body.
									const served = mailResponses.find((r) => r.url === mailFrame.url);
									if (!served || served.statusCode !== 200) {
										throw new Error(`Smoke: the message frame got ${served?.statusCode ?? "no response"}`);
									}
									console.log(`SMOKE_DEMO mail frame=${mailFrame.url}`);
									await new Promise((r) => setTimeout(r, 400));
								}
								for (const theme of ["light", "dark"] as const) {
									nativeTheme.themeSource = theme;
									await window.webContents.executeJavaScript(
										`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
									);
									await new Promise((r) => setTimeout(r, 400));
									const image = await capture(window.webContents);
									writeFileSync(
										joinPath(shotDir, `${screen.toLowerCase()}-${theme}.png`),
										image.toPNG(),
									);
								}
							}

							// Settings is a window of its own, so it is photographed as one.
							// Opened through the same function the sidebar button calls, which
							// is also what proves the modal child actually opens.
							if (process.env.JUNO_SMOKE_DEMO) {
								const { closeSettingsWindow, getSettingsWindow, openSettingsWindow } =
									await import("./main/windows");

								openSettingsWindow();
								const settingsWindow = getSettingsWindow();
								if (!settingsWindow) throw new Error("Smoke: the settings window did not open");

								await new Promise<void>((resolve) => {
									if (!settingsWindow.webContents.isLoading()) {
										setTimeout(resolve, 900);
										return;
									}
									settingsWindow.webContents.once("did-finish-load", () =>
										setTimeout(resolve, 900),
									);
								});

								const TABS = `document.querySelectorAll("nav[aria-label='Settings sections'] button")`;
								const tabs = (await settingsWindow.webContents.executeJavaScript(
									`[...${TABS}].map((b) => b.textContent.trim())`,
								)) as string[];
								if (tabs.length < 5) {
									throw new Error(`Smoke: the settings window showed ${tabs.length} sections`);
								}

								for (const [index, tab] of tabs.entries()) {
									await settingsWindow.webContents.executeJavaScript(`${TABS}[${index}].click()`);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await settingsWindow.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 350));
										const image = await capture(settingsWindow.webContents);
										const name = tab.toLowerCase().replace(/[^a-z0-9]+/g, "-");
										writeFileSync(
											joinPath(shotDir, `settings-${name}-${theme}.png`),
											image.toPNG(),
										);
									}
								}
								// Your business is taller than the window, so the loop above
								// photographs the fields and never the two contact lists under
								// them, which is where the primary and the mail-account mark are.
								{
									const business = tabs.findIndex((tab) => tab === "Your business");
									if (business === -1) throw new Error("Smoke: the settings window has no business section");
									await settingsWindow.webContents.executeJavaScript(`${TABS}[${business}].click()`);
									await new Promise((r) => setTimeout(r, 300));
									const listed = (await settingsWindow.webContents.executeJavaScript(
										`(() => {
											const main = document.querySelector("main");
											main.scrollTop = main.scrollHeight;
											return main.textContent.includes("Email addresses") && main.textContent.includes("Mail account");
										})()`,
									)) as boolean;
									if (!listed) {
										throw new Error("Smoke: the business section did not list the owner's addresses");
									}
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await settingsWindow.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 300));
										const image = await capture(settingsWindow.webContents);
										writeFileSync(joinPath(shotDir, `settings-your-contacts-${theme}.png`), image.toPNG());
									}
								}

								// General is taller than the window too, and what falls off the
								// bottom is the whole update section: the version, what the last
								// check found, and the automatic-install toggle.
								{
									const general = tabs.findIndex((tab) => tab === "General");
									if (general === -1) throw new Error("Smoke: the settings window has no general section");
									await settingsWindow.webContents.executeJavaScript(`${TABS}[${general}].click()`);
									await new Promise((r) => setTimeout(r, 300));
									const shown = (await settingsWindow.webContents.executeJavaScript(
										`(() => {
											const main = document.querySelector("main");
											main.scrollTop = main.scrollHeight;
											return main.textContent.includes("Install updates automatically");
										})()`,
									)) as boolean;
									if (!shown) {
										throw new Error("Smoke: the general section did not show the update settings");
									}
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await settingsWindow.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 300));
										const image = await capture(settingsWindow.webContents);
										writeFileSync(joinPath(shotDir, `settings-updates-${theme}.png`), image.toPNG());
									}
								}

								// The MCP tab hides half of itself behind a two-way switch, so the
								// loop above only ever photographs the installers. The other side
								// is the block someone pastes by hand, and it has broken before.
								{
									const mcp = tabs.findIndex((tab) => tab === "MCP");
									if (mcp === -1) throw new Error("Smoke: the settings window has no MCP section");
									await settingsWindow.webContents.executeJavaScript(`${TABS}[${mcp}].click()`);
									await new Promise((r) => setTimeout(r, 250));
									const switched = (await settingsWindow.webContents.executeJavaScript(
										`(() => {
											const b = [...document.querySelectorAll("button[role=radio]")]
												.find((el) => el.textContent.trim() === "Do it myself");
											if (!b) return false;
											b.click();
											return true;
										})()`,
									)) as boolean;
									if (!switched) throw new Error("Smoke: the MCP section had no way to the manual route");
									await new Promise((r) => setTimeout(r, 350));
									const pasted = (await settingsWindow.webContents.executeJavaScript(
										`(document.querySelector("pre")?.textContent ?? "").includes("mcpServers")`,
									)) as boolean;
									if (!pasted) throw new Error("Smoke: the manual route printed no configuration");
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await settingsWindow.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 300));
										const image = await capture(settingsWindow.webContents);
										writeFileSync(joinPath(shotDir, `settings-mcp-manual-${theme}.png`), image.toPNG());
									}
								}
								console.log(`SMOKE_DEMO settings tabs=${tabs.length}`);
								closeSettingsWindow();
							}
						}
						console.log(`SMOKE_READY migrations=${migrations.applied.length} db=${databasePath()}`);
						app.quit();
					})();
				}, 1200);
			});
		}

		app.on("activate", () => {
			if (getMainWindow()) focusMainWindow();
			else openMainWindow(isDev);
		});
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	app.on("before-quit", () => {
		notifications.stop();
		// A dev server left behind by a closed app is a port nobody can explain.
		projectRunner.stopAll();
		mailSync.stopScheduler();
		mailSend.stopScheduler();
		stopAgentSurface({ userDataDir: userDataDir(), instanceKey: databasePath() });
		closeDb();
	});
}
