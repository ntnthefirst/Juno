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
import {
	backupsDir,
	databasePath,
	documentsDir,
	mailDir,
	projectsDir,
	templateAssetsDir,
	userDataDir,
} from "./main/db/paths";
import { safeStorageCredentialStore } from "./main/credential-store";
import { registerAllIpc } from "./main/ipc";
import * as agentAudit from "./main/services/agent-audit";
import { configureAgentInstall } from "./main/services/agent-install";
import { serverStatus, startAgentSurface, startAutomationScheduler, stopAgentSurface } from "./main/mcp";
import { registerAppScheme, registerAppSchemePrivileges } from "./main/scheme";
import { configureBackups, setCloseHook } from "./main/services/backup";
import { configureDocuments } from "./main/services/document-pdf";
import { ensureTemplatesSeeded } from "./main/services/document-templates";
import { configureDocumentStorage } from "./main/services/documents";
import { configureTemplateAssets } from "./main/services/document-template-assets";
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
import { installOnQuit, startUpdates } from "./main/services/updates";
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
		configureTemplateAssets(templateAssetsDir());
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
			console.log(`Templates: ${templateSeed.created} created, ${templateSeed.updated} updated`);
		}

		const mailTemplateSeed = await ensureMailTemplatesSeeded(db);
		if (mailTemplateSeed.created || mailTemplateSeed.updated) {
			console.log(`Mail templates: ${mailTemplateSeed.created} created, ${mailTemplateSeed.updated} updated`);
		}

		const reminderSeed = await ensureRemindersSeeded(db);
		if (reminderSeed.created) {
			console.log(`Reminders: ${reminderSeed.created} created`);
		}

		// Housekeeping on the log, not on data anything is built from. A failure
		// here is a launch with a longer log, not a broken one, so it never stops
		// boot.
		try {
			const purged = agentAudit.purgeOldEvents(db);
			if (purged > 0) {
				console.log(`Audit log: ${purged} row(s) purged`);
			}
		} catch (cause) {
			console.error("Audit log purge failed:", cause instanceof Error ? cause.message : cause);
		}

		// Restoring a backup replaces the live file, which cannot happen while the
		// connection holds it open. The service asks for the close rather than
		// importing app lifecycle code itself.
		setCloseHook(() => closeDb());

		lock.start(await settings.getLock());

		splashStep("Starting services");
		registerAllIpc();

		// Writing Juno into the agent clients on this machine needs the address
		// the settings screen shows, so it is given the same answer rather than
		// working it out a second time.
		configureAgentInstall({
			status: () => serverStatus(),
			home: homedir(),
			platform: process.platform,
		});

		// The agent surface comes up after IPC, because the gate it enforces is
		// answered over IPC, and after the lock, because every tool checks it. A
		// development run listens on its own port, so it can be open beside the
		// installed one, and a smoke run lets the system choose.
		await startAgentSurface({
			userDataDir: userDataDir(),
			defaultPort: app.isPackaged ? 5866 : 5867,
			version: app.getVersion(),
			ephemeralPort: Boolean(process.env.JUNO_SMOKE),
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

						// The line Juno says when it starts, with the address and the button
						// that copies it. It stays up for a few seconds only, so it is looked
						// for first, before anything slow.
						const startupNotice = (await window.webContents.executeJavaScript(
							`new Promise(async (resolve) => {
								for (let i = 0; i < 30; i++) {
									const toast = document.querySelector("[role=status]");
									if (toast && toast.textContent.includes("MCP server enabled on http://127.0.0.1:")) {
										return resolve(toast.textContent);
									}
									await new Promise((r) => setTimeout(r, 200));
								}
								resolve("");
							})`,
						)) as string;
						if (!startupNotice.includes("Copy URL")) {
							throw new Error(`Smoke: Juno did not say where the agent server listens: "${startupNotice}"`);
						}
						console.log(`SMOKE_DEMO startup notice=${startupNotice}`);
						if (process.env.JUNO_SMOKE_SHOT) {
							const { mkdirSync, writeFileSync } = await import("node:fs");
							const { join: joinPath } = await import("node:path");
							mkdirSync(process.env.JUNO_SMOKE_SHOT, { recursive: true });
							writeFileSync(
								joinPath(process.env.JUNO_SMOKE_SHOT, "mcp-notice.png"),
								(await window.webContents.capturePage()).toPNG(),
							);
						}

						if (process.env.JUNO_SMOKE_DEMO) {
							// No server in a smoke run: the sync reads from a mailbox in memory.
							const { openSmokeMailbox, smokeTransport, smokeAppender } =
								await import("./main/smoke-mailbox");
							configureMailboxSource(openSmokeMailbox);
							configureMailTransport(smokeTransport, smokeAppender);

							const created = (await window.webContents.executeJavaScript(`(async () => {
								const b = window.juno;
								const statuses = await b.reference.getSet("client_status");
								const active = statuses.items.find((i) => i.key === "active") ?? statuses.items[0];
								const lead = statuses.items.find((i) => i.key === "lead") ?? statuses.items[0];
								const made = [];
								for (const c of [
									{ name: "obet", city: "Gent", postalCode: "9000", email: "hallo@obet.be", statusId: active.id },
									{ name: "bodhi", city: "Brugge", postalCode: "8000", email: "info@bodhi.be", statusId: active.id },
									{ name: "noir", city: "Antwerpen", postalCode: "2000", statusId: active.id },
									{ name: "hyge", city: "Leuven", postalCode: "3000", statusId: lead.id },
								]) {
									const client = await b.clients.create({ name: c.name, statusId: c.statusId });
									if (c.email) await b.clientEmails.create({ clientId: client.id, email: c.email });
									await b.clientAddresses.create({ clientId: client.id, addressLine1: "Kerkstraat 1", postalCode: c.postalCode, city: c.city });
									made.push(client);
								}
								await b.contacts.create({ clientId: made[0].id, name: "Laura", role: "Zaakvoerder", email: "laura@obet.be", isPrimary: true });
								const ps = await b.reference.getSet("project_status");
								const running = ps.items.find((i) => i.key === "active") ?? ps.items[0];
								await b.projects.create({ clientId: made[0].id, name: "Ontwikkelovereenkomst site", statusId: running.id, dueOn: "2026-11-14", agreedValueCents: 210000 });
								await b.projects.create({ clientId: made[1].id, name: "Project scope", statusId: running.id, dueOn: "2026-10-03", agreedValueCents: 125000 });
								await b.settings.setOwner({ businessName: "Juno", firstName: "Nathan", lastName: "Peeters", addressLine1: "Kerkstraat 1", postalCode: "9000", city: "Gent", vatNumber: "BE0123456789", establishmentNumber: "2123456789" });
								// Phase 1: generate a document through the same bridge the
								// interface uses, so the smoke run covers it too.
								// A first install holds one document template and no other: the
								// example, written as an ordinary template. Nothing here may look it
								// up by key, because that is not how anyone finds it.
								const seededTemplates = await b.templates.list();
								if (seededTemplates.length !== 1) throw new Error("Smoke: a first install should hold exactly one document template, found " + seededTemplates.length);
								const tpl = seededTemplates[0];
								if (tpl.isSystem || tpl.reviewedAt !== null || !tpl.layout || tpl.layout.pages.length < 2 || tpl.inputs.length === 0) {
									throw new Error("Smoke: the example is not an unreviewed, paged template that asks for inputs: " + JSON.stringify({ isSystem: tpl.isSystem, reviewedAt: tpl.reviewedAt, pages: tpl.layout?.pages.length, inputs: tpl.inputs.length }));
								}
								const exampleValues = Object.fromEntries(tpl.inputs.map((input) => [input.key, input.defaultValue ?? "het ontwerp en de bouw van een website"]));
								const gen = await b.documents.generate({
									clientId: made[0].id, templateId: tpl.id, projectId: (await b.projects.list({ clientId: made[0].id }))[0]?.id ?? null,
									extras: exampleValues,
								});
								// Every placeholder answered by the records and the inputs above. A
								// marker left in the example would be printed in the first document
								// anyone makes from it.
								if (gen.missing.length !== 0) throw new Error("Smoke: the example left placeholders unresolved: " + gen.missing.join(", "));
								if (!gen.document.isSpecimen) throw new Error("Smoke: a document from an unreviewed template is not marked as a specimen");
								// A hand-written document template, HTML only, for the same reason as
								// the mail one further down: the walk reads it in the code view and starts a
								// page layout on it, and the example is already laid out.
								await b.templates.create({
									name: "Handgeschreven overeenkomst",
									bodyHtml: "<h1>Overeenkomst</h1><p>Tussen {{ owner.businessName }} en {{ client.name }}.</p>",
								});
								// A template laid out on paper, which fills in what it asks for and
								// nothing else. Printed through the bridge before anyone is chosen to
								// receive it, then generated for a client, which must give a document
								// that says what was typed and nothing taken from the client.
								const paperTemplate = await b.templates.create({ name: "Offerte op papier" });
								if (!paperTemplate.canvas) throw new Error("Smoke: a new document template is not laid out on paper");
								const firstPage = paperTemplate.canvas.layout.children[0];
								if (!firstPage || firstPage.kind !== "container") throw new Error("Smoke: a new canvas has no page");
								const scopeText = {
									id: "smoke-scope", kind: "text", tag: "p", grow: 0, alignSelf: "auto", hidden: false, actions: [],
									html: "Omvang: {{document.omvang}}",
									text: { color: null, fontFamily: null, fontSize: null, lineHeight: null, letterSpacing: null, weight: "normal", italic: false, decoration: "none", transform: "none", align: "left", verticalAlign: "top" },
									box: { ...firstPage.box, fill: null, padding: { top: 0, right: 0, bottom: 0, left: 0 }, margin: { top: 0, right: 0, bottom: 0, left: 0 }, width: null, minHeight: null, clip: false },
								};
								await b.templates.update(paperTemplate.id, {
									inputs: [{ key: "omvang", label: "Omvang", kind: "textarea", required: true }],
									canvas: { ...paperTemplate.canvas, layout: { ...paperTemplate.canvas.layout, children: [{ ...firstPage, children: [scopeText] }] } },
								});
								const printedPaper = await b.templates.renderPdf({ templateId: paperTemplate.id, values: { omvang: "Een website" } });
								if (printedPaper.missing.length !== 0 || String.fromCharCode(...printedPaper.pdf.slice(0, 4)) !== "%PDF") {
									throw new Error("Smoke: a canvas template did not print: " + printedPaper.missing.join(", "));
								}
								// A long text on one page with a picture the template keeps, for the
								// editor's page flow and the picture route below.
								const longTemplate = await b.templates.create({ name: "Lange tekst op papier" });
								const longPage = longTemplate.canvas.layout.children[0];
								const pixel = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
								const logo = await b.templates.assets.add({ templateId: longTemplate.id, fileName: "logo.png", data: pixel });
								const logoBlock = { id: "smoke-logo", kind: "image", src: logo.token, alt: "Logo", width: 48, align: "left", grow: 0, alignSelf: "start", hidden: false, actions: [], box: scopeText.box };
								const paragraphs = Array.from({ length: 70 }, (_, index) => ({ ...scopeText, id: "smoke-long-" + index, html: "Artikel " + (index + 1) + ". Deze tekst loopt door tot ver voorbij de onderkant van het blad." }));
								await b.templates.update(longTemplate.id, {
									canvas: { ...longTemplate.canvas, layout: { ...longTemplate.canvas.layout, children: [{ ...longPage, children: [logoBlock, ...paragraphs] }] } },
								});
								const paperDocument = await b.documents.generate({ clientId: made[0].id, templateId: paperTemplate.id, extras: { omvang: "Een website" } });
								if (paperDocument.pdfError !== null || !paperDocument.document.bodyHtml.includes("Omvang: Een website")) {
									throw new Error("Smoke: a canvas template did not generate its document: " + paperDocument.pdfError);
								}
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
								// A hand-written template of the walk's own. A fresh install ships
								// none of the old ones, and the walk below still needs one that is
								// HTML only, to read in the code view and to lay out on a canvas.
								await b.mail.templates.create({
									name: "Herinnering betaling",
									subject: "Herinnering: {{ document.title }}",
									bodyHtml: "<p>Beste {{ client.contactName }},</p><p>Volgens mijn administratie staat {{ document.title }} nog open. Mogelijk is de betaling al onderweg.</p><p>Met vriendelijke groeten,<br>{{ owner.contactName }}</p>",
								});
								// Two addresses and a number, so the lists under Your business are
								// photographed with something in them. The second one is the case
								// the lists exist for: an address that is kept and never read.
								await b.settings.addOwnerEmail({ email: "hallo@juno.test", label: "general" });
								await b.settings.addOwnerEmail({ email: "nathan@vorigedomein.be", label: "old domain, forwards nowhere" });
								await b.settings.addOwnerPhone({ phone: "+32 470 00 00 00", label: "gsm" });
								const mailAccount = await b.mail.accounts.create({ email: "hallo@juno.test", label: "Juno", imapHost: "imap.juno.test", smtpHost: "smtp.juno.test", password: "smoke" });
								const synced = await b.mail.sync.run();
								if (synced.some((s) => s.phase !== "done")) throw new Error("Smoke: mail sync did not finish: " + JSON.stringify(synced));

								// Phase 4: the generated document sent as an attachment with an
								// empty body, by a person, and a second message an agent would
								// have to wait on.
								const draft = await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: "Laura", address: "laura@obet.be" }], subject: "Ontwikkelovereenkomst",
									bodyText: "", clientId: made[0].id, documentIds: [gen.document.id],
								});
								await b.mail.outbox.send(draft.id);
								await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: null, address: "info@noir.be" }], subject: "Even navragen",
									bodyText: "Dag,\\n\\nIs de offerte goed ontvangen?\\n\\nGroeten", clientId: made[2].id,
								});
								// A draft with a picture at a web address, which the window
								// may not fetch. The Drafts step checks it is drawn as a box.
								await b.mail.outbox.createDraft({
									accountId: mailAccount.id, to: [{ name: null, address: "info@noir.be" }], subject: "Met logo",
									bodyText: "Dag", bodyHtml: '<p>Dag</p><img src="https://www.example.com/logo.png" alt="Logo" style="width:96px">', clientId: made[2].id,
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
							})()`)) as { clients: number; projectId: string };
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
									const cover = await projectAssets.add({
										projectId: created.projectId,
										sourcePath: icon,
									});
									await projectAssets.add({
										projectId: created.projectId,
										sourcePath: icon,
										storage: "linked",
									});
									await projectsService.setCover(created.projectId, cover.id);
									const where = await projectsService.storage(created.projectId);
									if (where.fileCount !== 1) {
										throw new Error(
											`Smoke: the project folder holds ${where.fileCount} files, not the one managed copy`,
										);
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
							const parked = (await callTool(
								"clients.create",
								{ name: "parked-by-agent" },
								{ source: "mcp" },
							)) as {
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

							// The server, for real: the listener, the token and the protocol over
							// HTTP, exactly as a client sends it. The handshake that hands a token
							// out is covered by its own tests; here a token is made the way the
							// settings screen makes one.
							{
								const server = await serverStatus();
								if (!server.running) throw new Error(`Smoke: the agent server is not listening: ${server.error}`);
								const post = (body: unknown, token: string | null) =>
									fetch(server.url, {
										method: "POST",
										headers: {
											"Content-Type": "application/json",
											Accept: "application/json, text/event-stream",
											...(token ? { Authorization: `Bearer ${token}` } : {}),
										},
										body: JSON.stringify(body),
									});

								const refused = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
								if (refused.status !== 401) throw new Error(`Smoke: a client with no token got ${refused.status}`);

								const { createToken, revoke } = await import("./main/services/agent-connections");
								const made = createToken("smoke");
								try {
									const listed = (await (
										await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, made.token)
									).json()) as { result?: { tools?: unknown[] } };
									const count = listed.result?.tools?.length ?? 0;
									if (count < 90) throw new Error(`Smoke: the server listed ${count} tools`);
									console.log(`SMOKE_DEMO server tools=${count}`);

									const called = (await (
										await post(
											{
												jsonrpc: "2.0",
												id: 3,
												method: "tools/call",
												params: { name: "briefing.today", arguments: {} },
											},
											made.token,
										)
									).json()) as { result?: { isError?: boolean; content?: { text: string }[] } };
									const reply = called.result?.content?.[0]?.text ?? "";
									if (called.result?.isError || !reply.includes("headline")) {
										throw new Error(`Smoke: the server call failed: ${reply}`);
									}
									console.log("SMOKE_DEMO server briefing=ok");
								} finally {
									revoke(made.connection.id);
								}
							}
							// The sender is not scheduled in a smoke run, so it is asked directly,
							// and the row has to come out the other side as sent.
							const sentCount = await mailSend.processQueue();
							const outboxRows = await (
								await import("./main/services/mail-outbox")
							).list({ states: ["sent"] });
							if (sentCount !== 1 || outboxRows.length !== 1 || outboxRows[0]!.attachments.length !== 1) {
								throw new Error(
									`Smoke: the outbox did not send the document mail: ${JSON.stringify(outboxRows)}`,
								);
							}
							console.log(`SMOKE_DEMO outbox sent=${outboxRows[0]!.messageId}`);

							// printToPDF on a window that has not finished loading produces a
							// blank page and does not error, so the bytes are what has to be
							// checked, not the path. A blank A4 is about a kilobyte; a rendered
							// contract is several.
							{
								const { statSync, readFileSync: readPdfBytes } = await import("node:fs");
								const generatedRows = await (await import("./main/services/documents")).list({});
								// The example is the one laid out as pages; the one on paper is
								// checked on its own below.
								const generated = generatedRows.find(
									(row) => row.sourceKind === "generated" && row.pdfPath !== null && !row.bodyHtml.includes("juno-sheets"),
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
								// The example is two pages, and the specimen banner sits above them. A
								// page that spills onto a third sheet is a layout fault the bytes above
								// would never show.
								const { PDFDocument } = await import("pdf-lib");
								const sheets = (await PDFDocument.load(readPdfBytes(generated.pdfPath))).getPageCount();
								if (sheets !== 2) throw new Error(`Smoke: the example printed on ${sheets} sheets, not its two pages`);
								console.log(`SMOKE_DEMO generated pdf=${size} sheets=${sheets}`);
								// A template on paper prints one sheet per page, at the paper's
								// size, whatever A4 the printer was told to default to.
								const onPaper = generatedRows.find((row) => row.pdfPath !== null && row.bodyHtml.includes("juno-sheets"));
								if (!onPaper?.pdfPath) throw new Error("Smoke: the document on paper has no PDF");
								const paperPdf = await PDFDocument.load(readPdfBytes(onPaper.pdfPath));
								const { width: sheetWidth, height: sheetHeight } = paperPdf.getPage(0).getSize();
								if (paperPdf.getPageCount() !== 1 || Math.round(sheetWidth) !== 595 || Math.round(sheetHeight) !== 842) {
									throw new Error(`Smoke: the document on paper printed ${paperPdf.getPageCount()} sheets of ${sheetWidth} x ${sheetHeight}, not one A4`);
								}
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

							/**
							 * Lifts a window over whatever is in front of it, for a run that
							 * is going to be read as evidence.
							 *
							 * A window that is occluded is not composited, so its captures are
							 * the frame from before it was covered, and no amount of waiting
							 * fixes that (verify.md). `JUNO_SMOKE_FRONT=1` is how a run on a
							 * machine nobody is sitting at still produces screenshots worth
							 * looking at. It is off by default, because a run that steals the
							 * screen is a run nobody starts twice.
							 */
							const front = (target: Electron.BrowserWindow | null) => {
								if (!process.env.JUNO_SMOKE_FRONT || !target || target.isDestroyed()) return;
								target.setAlwaysOnTop(true, "screen-saver");
								target.show();
								target.focus();
							};
							front(window);

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
								front(setup);
								const flow = setup.webContents;

								const setupPresent = (await flow.executeJavaScript(
									`(() => {
										const buttons = [...document.querySelectorAll("button")].map((el) => el.textContent.trim());
										if (!buttons.includes("Set up Juno")) return "no first step";
										// Setup cannot be skipped as a whole any more. A way past it
										// reappearing here is the regression this asserts against.
										return buttons.includes("Skip setup") ? "still offers a skip" : "ok";
									})()`,
								)) as string;

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
								await flow.executeJavaScript(
									`document.documentElement.setAttribute("data-theme", "light")`,
								);

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
									const advanced = (await flow.executeJavaScript(
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
									)) as boolean;
									if (!advanced)
										throw new Error(`Smoke: setup step ${step} had nothing to continue with`);
									// Pressing Continue on a step that refuses to be passed leaves
									// the rail where it was, which is the failure worth catching:
									// a required field nobody can satisfy is a dead end for every
									// new install, and it looks like a click that did not land.
									await new Promise((r) => setTimeout(r, 400));
									const now = (await flow.executeJavaScript(
										`(document.querySelector("[aria-current=step]")?.getAttribute("aria-label") ?? "")`,
									)) as string;
									if (now === label) throw new Error(`Smoke: setup would not move past ${label}`);
								}

								await new Promise((r) => setTimeout(r, 500));
								const done = await capture(flow);
								writeFileSync(joinPath(shotDir, `setup-done.png`), done.toPNG());

								// Takes the tour rather than skipping straight in, so the
								// walkthrough is proven live at least once per run: it is the one
								// screen this file otherwise has no way to reach, since it only ever
								// offers itself on a first run or an unseen upgrade.
								const startedTour = (await flow.executeJavaScript(
									`(() => {
										const tour = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Take the walkthrough");
										if (!tour) return false;
										tour.click();
										return true;
									})()`,
								)) as boolean;
								if (!startedTour)
									throw new Error("Smoke: the last setup step had no way into the walkthrough");

								// The window closes itself on the way out, and the main window is
								// told so it can start the tour. Both have to happen, so wait for
								// the first before asking about the second.
								for (let wait = 0; wait < 40 && getSetupWindow(); wait++) {
									await new Promise((r) => setTimeout(r, 250));
								}
								if (getSetupWindow())
									throw new Error("Smoke: the setup window stayed open after it finished");

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
								for (const expected of ["Calendar", "Clients"]) {
									const advanced = (await window.webContents.executeJavaScript(
										`(() => {
											const card = document.querySelector("[role=dialog][aria-modal=true]");
											const next = card ? [...card.querySelectorAll("button")].find((el) => el.textContent.trim() === "Next") : null;
											if (!next) return false;
											next.click();
											return true;
										})()`,
									)) as boolean;
									if (!advanced) throw new Error("Smoke: the walkthrough had no way to step forward");
									await new Promise((r) => setTimeout(r, 500));
									const title = await cardTitle();
									if (title !== expected) {
										throw new Error(
											`Smoke: the walkthrough showed "${title}" where "${expected}" was expected`,
										);
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

								const shellUp = (await window.webContents.executeJavaScript(
									`Boolean(document.querySelector("nav button[data-nav]"))`,
								)) as boolean;
								if (!shellUp)
									throw new Error("Smoke: closing the walkthrough did not reveal the application");
							}

							// JUNO_SMOKE_ONLY=settings skips the walk over the screens and goes
							// straight to the settings window, which is what a change to settings
							// needs to look at and what the full walk makes eight minutes of waiting.
							const screens = process.env.JUNO_SMOKE_ONLY === "settings"
								? []
								: process.env.JUNO_SMOKE_DEMO
								? [
										"Today",
										"Reminders",
										"Clients",
										"Client record",
										"Projects",
										"Projects as a list",
										"Project record",
										"Calendar",
										"Week",
										"Event form",
										"Mail",
										"Drafts",
										"Documents",
										"Agent",
										"Connection",
										"Mail templates",
										"Document templates",
									]
								: ["Clients"];
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
									const reached = (await window.webContents.executeJavaScript(
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
									)) as string;
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
									const grid = (await window.webContents.executeJavaScript(
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
									)) as string;
									if (grid !== "ok") throw new Error(`Smoke: projects ${grid}`);
								}
								if (screen === "Projects as a list") {
									// The other two layouts, which is the whole point of the
									// switcher. Going back to cards afterwards leaves the stored
									// preference where the record shot below expects it.
									const switched = (await window.webContents.executeJavaScript(
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
									)) as string;
									if (switched !== "ok") throw new Error(`Smoke: project layouts ${switched}`);
								}
								if (screen === "Project record") {
									const opened = (await window.webContents.executeJavaScript(
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
											if (!main.textContent.includes("Dates and reminders")) return "no dates section on the project";
											const addDate = [...main.querySelectorAll("button")].find((el) => el.textContent.trim() === "Add date");
											if (!addDate) return "no add date button on the project";
											addDate.click();
											await wait(600);
											if (!document.querySelector("main").textContent.includes("New event")) return "the date form did not open from the project";
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await wait(700);
											if (!document.querySelector("main").textContent.includes("Dates and reminders")) return "back did not return to the project";
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
									)) as string;
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
											// Dates and reminders belong to the client too: the section is
											// there, and adding one opens a page, not a dialog, and back
											// returns to the client.
											if (!main.textContent.includes("Dates and reminders")) return "no dates section on the client";
											const addReminder = [...main.querySelectorAll("button")].find((el) => el.textContent.trim() === "Add reminder");
											if (!addReminder) return "no add reminder button on the client";
											addReminder.click();
											await new Promise((r) => setTimeout(r, 600));
											if (!document.querySelector("main").textContent.includes("New reminder")) return "the reminder form did not open from the client";
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 700));
											if (!document.querySelector("main [role=tablist]")) return "back did not return to the client";
											const timeline = [...main.querySelectorAll("[role=tab]")].find((el) => el.textContent.trim().startsWith("Timeline"));
											if (!timeline) return "no timeline tab";
											timeline.click();
											await new Promise((r) => setTimeout(r, 700));

											// The status beside the name is a button. Picking a status
											// it is not on already changes it and writes a timeline entry.
											const statusButton = main.querySelector("button[aria-label^='Change status for']");
											if (!statusButton) return "no status button";
											statusButton.click();
											await new Promise((r) => setTimeout(r, 300));
											const items = [...document.querySelectorAll("[role=menuitem]")];
											if (items.length === 0) return "no status menu";
											// An item with no check icon is not the current status.
											const pick = items.find((el) => !el.querySelector("svg"));
											if (!pick) return "every status is already picked";
											pick.click();
											await new Promise((r) => setTimeout(r, 700));
											if (!main.textContent.includes("Status changed from")) {
												return "no status change on the timeline";
											}
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
											if (!main.textContent.includes("http://127.0.0.1:")) return "no server address";
											const power = main.querySelector("button[role=switch]");
											if (!power || power.getAttribute("aria-checked") !== "true") return "the server switch is not on";
											// The installers are one of two routes and the block of
											// configuration is the other, so both sides of the switch
											// are checked here rather than assuming which one is up.
											if (!main.textContent.includes("Claude Code")) return "no client list";
											const manual = [...main.querySelectorAll("button[role=radio]")].find((el) => el.textContent.trim() === "Do it myself");
											if (!manual) return "no manual route";
											manual.click();
											await new Promise((r) => setTimeout(r, 400));
											if (!(main.querySelector("pre")?.textContent ?? "").includes("http://127.0.0.1:")) return "no configuration block";
											const installers = [...main.querySelectorAll("button[role=radio]")].find((el) => el.textContent.trim() === "Let Juno do it");
											if (installers) installers.click();
											await new Promise((r) => setTimeout(r, 400));
											return "ok";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: agent connection ${opened}`);

										// The prompt a client's first connection raises, answered the
										// way a person answers it: the code is typed, not clicked. The
										// request is made through the service, as the listener does
										// when a client opens the authorisation page.
										const { createHash } = await import("node:crypto");
										const agentConnections = await import("./main/services/agent-connections");
										const redirectUri = "http://127.0.0.1:53682/callback";
										const smokeClient = agentConnections.registerClient({
											clientName: "Smoke client",
											redirectUris: [redirectUri],
										});
										const started = agentConnections.beginPairing({
											clientId: smokeClient.clientId,
											redirectUri,
											codeChallenge: createHash("sha256").update("smoke".repeat(10)).digest("base64url"),
											codeChallengeMethod: "S256",
											state: "smoke",
										});
										await new Promise((r) => setTimeout(r, 700));
										const prompt = (await window.webContents.executeJavaScript(
											`(() => document.querySelector("[role=dialog]")?.textContent ?? "")()`,
										)) as string;
										if (!prompt.includes("Smoke client") || !prompt.includes("Connect an app")) {
											throw new Error("Smoke: the connection prompt did not appear");
										}
										if (prompt.includes(started.code)) {
											throw new Error("Smoke: the connection prompt shows the code it is asking for");
										}
										for (const theme of ["light", "dark"] as const) {
											nativeTheme.themeSource = theme;
											await window.webContents.executeJavaScript(
												`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
											);
											await new Promise((r) => setTimeout(r, 300));
											const image = await capture(window.webContents);
											writeFileSync(joinPath(shotDir, `agent-pairing-${theme}.png`), image.toPNG());
										}
										// A wrong code first, which has to be refused and counted.
										window.webContents.focus();
										const wrong = started.code === "000000" ? "111111" : "000000";
										await window.webContents.insertText(wrong);
										await new Promise((r) => setTimeout(r, 700));
										const refused = (await window.webContents.executeJavaScript(
											`(() => document.querySelector("[role=dialog]")?.textContent ?? "")()`,
										)) as string;
										if (!refused.includes("2 tries left")) {
											throw new Error(`Smoke: a wrong code was not refused: ${refused}`);
										}
										await window.webContents.insertText(started.code);
										await new Promise((r) => setTimeout(r, 900));
										const gone = (await window.webContents.executeJavaScript(
											`document.querySelector("[role=dialog]") === null`,
										)) as boolean;
										const outcome = agentConnections.pairingStatus(started.pairingId);
										if (!gone || outcome.status !== "done" || outcome.denied) {
											throw new Error(`Smoke: typing the code did not let the client in: ${JSON.stringify(outcome)}`);
										}
										console.log("SMOKE_DEMO pairing=typed");
								}
								if (screen === "Clients") {
									// A notes field is CodeMirror now, not a textarea, and the only
									// way to know typing into one still reaches the document is to
									// type into one. The client form is the simplest place that has it.
									const noted = (await window.webContents.executeJavaScript(
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
									)) as string;
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
								if (screen === "Documents") {
									// The search bar and the selection above the table: typed text
									// narrows the rows, select-all ticks every one left, and both are
									// cleared again so the screenshot below still shows the list at
									// rest with everything in it.
									const searched = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											const search = document.querySelector('input[aria-label="Search documents"]');
											if (!search) return "no search field";
											setValue.call(search, "zzz-nothing-matches-zzz");
											search.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(250);
											const main = document.querySelector("main");
											if (!main.textContent.includes("Nothing matches")) return "the search did not filter the rows";
											setValue.call(search, "");
											search.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(250);
											const selectAll = document.querySelector('input[aria-label="Select all"]');
											if (!selectAll) return "no select-all checkbox";
											selectAll.click();
											await wait(200);
											if (!main.textContent.includes("selected")) return "select-all did not select the rows";
											const clear = document.querySelector('input[aria-label="Clear selection"]');
											if (!clear) return "select-all left no way to clear the selection";
											clear.click();
											await wait(200);
											return "ok";
										})()`,
									)) as string;
									if (searched !== "ok") throw new Error(`Smoke: documents list ${searched}`);

									// Opening a document opens its PDF: a canvas that painted, and the
									// column beside it with the versions and the timeline. A viewer that
									// throws draws a message instead of a canvas, which is what this reads.
									const viewed = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const row = document.querySelector("tbody tr button[type='button']");
											if (!row) return "no document row to open";
											row.click();
											await wait(2000);
											const aside = document.querySelector("aside[aria-label='Document']");
											if (!aside) return "no document column";
											for (const heading of ["Details", "Versions", "Timeline"]) {
												if (![...aside.querySelectorAll("h3")].some((el) => el.textContent.startsWith(heading))) {
													return "the column has no " + heading + " section";
												}
											}
											const canvas = document.querySelector("main canvas");
											if (!canvas || canvas.width === 0) return "the viewer drew no page";
											if (document.querySelector("main").textContent.includes("Could not open this PDF")) return "the viewer could not open the PDF";
											if (!aside.querySelector("ol li")) return "the column lists no versions or timeline";
											return "ok";
										})()`,
									)) as string;
									if (viewed !== "ok") throw new Error(`Smoke: document viewer ${viewed}`);
									if (shotDir) {
										for (const theme of ["light", "dark"] as const) {
											nativeTheme.themeSource = theme;
											await window.webContents.executeJavaScript(
												`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
											);
											await new Promise((r) => setTimeout(r, 400));
											writeFileSync(
												joinPath(shotDir, `document-viewer-${theme}.png`),
												(await capture(window.webContents)).toPNG(),
											);
										}
									}
									// Back to the list, the way the record is left with Escape.
									await window.webContents.executeJavaScript(
										`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 400));
								}
								if (screen === "Document templates") {
									// The example first. It is the one template every first install has and
									// the only one laid out on more than one page, so its preview and its
									// editor are the first things a new owner opens.
									const inspected = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const row = [...document.querySelectorAll("main ul li button")].find((el) => el.textContent.includes("Voorbeeld"));
											if (!row) return "no row for the example";
											row.click();
											await wait(900);
											const frame = document.querySelector("main iframe");
											if (!frame) return "the example has no preview";
											return "ok";
										})()`,
									) as string;
									if (inspected !== "ok") throw new Error(`Smoke: the example document template ${inspected}`);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
										await new Promise((r) => setTimeout(r, 400));
										writeFileSync(joinPath(shotDir, `document-template-example-${theme}.png`), (await capture(window.webContents)).toPNG());
									}
									// Into the page editor, where both pages have to be there to click on.
									const laidOut = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											await wait(800);
											if (!document.querySelector("button[aria-label^='Page 1']")) return "no first page on the canvas";
											if (!document.querySelector("button[aria-label^='Page 2']")) return "no second page on the canvas";
											return "ok";
										})()`,
									) as string;
									if (laidOut !== "ok") throw new Error(`Smoke: the example document template editor ${laidOut}`);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
										await new Promise((r) => setTimeout(r, 400));
										writeFileSync(joinPath(shotDir, `document-template-example-editor-${theme}.png`), (await capture(window.webContents)).toPNG());
									}
									// Back out without a change, to the preview and then to the list, so the
									// steps after this start where they always did.
									const returned = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const back = () => [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Back");
											if (!back()) return "no back action from the editor";
											back().click();
											await wait(400);
											const dialog = document.querySelector("[role=dialog]");
											if (dialog) {
												const discard = [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Discard and leave");
												if (!discard) return "the editor asked to discard a change nobody made";
												discard.click();
												await wait(500);
											}
											if (!back()) return "no back action from the preview";
											back().click();
											await wait(500);
											return document.querySelector("main ul li button") ? "ok" : "did not return to the list";
										})()`,
									) as string;
									if (returned !== "ok") throw new Error(`Smoke: leaving the example document template ${returned}`);
								}
								if (screen === "Mail templates" || screen === "Document templates") {
									// Opens a template so the preview path runs for real: the
									// list renders, the row opens a preview, and the preview asks the
									// service to fill the template. A typecheck proves none of that,
									// and the preview is where a template screen would throw. For the
									// mail templates it is the hand-written one the walk made, which
									// the steps after this need.
									const opened = (await window.webContents.executeJavaScript(
										`(async () => {
											const wanted = ${JSON.stringify(screen === "Mail templates" ? "Herinnering betaling" : "Handgeschreven overeenkomst")};
											const row = [...document.querySelectorAll("main ul li button")].find((el) => el.textContent.includes(wanted));
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
									)) as string;
									if (opened !== "ok") throw new Error(`Smoke: ${screen} ${opened}`);
								}
								if (screen === "Document templates") {
									// The seeded templates carry no page layout, so the editor opens
									// in its plain-HTML mode first. Starting a layout, dropping a block
									// on the canvas and reading it back is the only thing in this app
									// that proves the page compiler's editor half, rather than only the
									// renderer that turns a finished layout into a PDF.
									const edited = (await window.webContents.executeJavaScript(
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
									)) as string;
									if (edited !== "ok") throw new Error(`Smoke: document template editor ${edited}`);

									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 400));
										const image = await capture(window.webContents);
										writeFileSync(
											joinPath(shotDir, `document-template-editor-${theme}.png`),
											image.toPNG(),
										);
									}

									// Leaves the block unsaved: the back arrow raises its own discard
									// dialog because the draft now differs from what "Start a page
									// layout" already wrote, and this is that path exercised for real.
									const leftEditor = (await window.webContents.executeJavaScript(
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
									)) as string;
									if (leftEditor !== "ok")
										throw new Error(`Smoke: leaving the document template editor ${leftEditor}`);

									// Walks Fill (skipped, the seeded templates ask for nothing extra),
									// Link and Review, stopping short of the generate button.
									const usedDocument = (await window.webContents.executeJavaScript(
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
									)) as string;
									if (usedDocument !== "ok")
										throw new Error(`Smoke: using a document template ${usedDocument}`);

									const useDocumentImage = await capture(window.webContents);
									writeFileSync(
										joinPath(shotDir, `use-document-template.png`),
										useDocumentImage.toPNG(),
									);

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
								if (screen === "Document templates") {
									// The plus beside the heading: asks for a name, creates a
									// template with one empty page as its body, and opens it straight
									// into the page editor built on that page rather than the plain-HTML
									// mode a template with no layout opens into.
									const created = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const back = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Back");
											if (!back) return "no back action from the preview";
											back.click();
											await wait(500);
											const plus = document.querySelector('button[aria-label="New document template"]');
											if (!plus) return "no plus on the list";
											plus.click();
											await wait(400);
											const field = document.querySelector('input[aria-label="New document template"]');
											if (!field) return "the plus did not open into a name field";
											const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											setValue.call(field, "Smoke document template");
											field.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(200);
											field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
											let canvas = null;
											for (let tries = 0; tries < 20 && !canvas; tries++) {
												await wait(150);
												canvas = document.querySelector("[data-canvas-content]");
											}
											if (!canvas) {
												const alert = document.querySelector("[role=alert]");
												return "the new template did not open on paper" + (alert ? ": " + alert.textContent.trim() : "");
											}
											return "ok";
										})()`,
									)) as string;
									if (created !== "ok")
										throw new Error(`Smoke: creating a document template ${created}`);

									// Leaves without editing further, back to that template's own
									// preview, which is where the screenshots below expect to be.
									// The canvas editor has no back button over the canvas: Escape
									// with nothing selected is the way out, as it is in the mail one.
									await window.webContents.executeJavaScript(
										`(async () => {
											window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 500));
										})()`,
									);

									// One more Back reaches the list, where the search bar and the
									// selection live. Typed text narrows the rows, select-all ticks
									// every one left, and both are cleared again so the screenshot
									// below still shows the list at rest.
									const searched = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const back = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Back");
											if (!back) return "no back action from the preview";
											back.click();
											await wait(500);
											const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											const search = document.querySelector('input[aria-label="Search document templates"]');
											if (!search) return "no search field";
											setValue.call(search, "zzz-nothing-matches-zzz");
											search.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(250);
											const main = document.querySelector("main");
											if (!main.textContent.includes("Nothing matches")) return "the search did not filter the list";
											setValue.call(search, "");
											search.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(250);
											const selectAll = document.querySelector('input[aria-label="Select all"]');
											if (!selectAll) return "no select-all checkbox";
											selectAll.click();
											await wait(200);
											if (!main.textContent.includes("selected")) return "select-all did not select the rows";
											const clear = document.querySelector('input[aria-label="Clear selection"]');
											if (!clear) return "select-all left no way to clear the selection";
											clear.click();
											await wait(200);
											return "ok";
										})()`,
									)) as string;
									if (searched !== "ok")
										throw new Error(`Smoke: document templates list ${searched}`);

									// The template laid out on paper: its preview is the PDF it
									// prints as, its editor is the canvas with a page of A4 on it,
									// and using it makes the PDF first and then asks about a client.
									const paperPreview = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const row = [...document.querySelectorAll("main ul li button")].find((el) => el.textContent.includes("Offerte op papier"));
											if (!row) return "no row for the template on paper";
											row.click();
											for (let tries = 0; tries < 40 && !document.querySelector("main canvas"); tries++) await wait(150);
											return document.querySelector("main canvas") ? "ok" : "the preview drew no PDF";
										})()`,
									)) as string;
									if (paperPreview !== "ok") throw new Error(`Smoke: document template on paper ${paperPreview}`);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
										await new Promise((r) => setTimeout(r, 400));
										writeFileSync(joinPath(shotDir, `document-template-paper-${theme}.png`), (await capture(window.webContents)).toPNG());
									}
									const paperEditor = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											for (let tries = 0; tries < 20 && !document.querySelector("[data-canvas-content]"); tries++) await wait(150);
											const content = document.querySelector("[data-canvas-content]");
											if (!content) return "no canvas";
											if (!content.textContent.includes("Omvang")) return "the page does not show its text";
											if (!document.body.textContent.includes("A4 portrait")) return "the sheet does not say its paper";
											return "ok";
										})()`,
									)) as string;
									if (paperEditor !== "ok") throw new Error(`Smoke: document canvas editor ${paperEditor}`);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
										await new Promise((r) => setTimeout(r, 400));
										writeFileSync(joinPath(shotDir, `document-template-paper-editor-${theme}.png`), (await capture(window.webContents)).toPNG());
									}
									const paperUse = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await wait(500);
											const use = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Use");
											if (!use) return "no use action on the preview";
											use.click();
											await wait(500);
											const field = document.querySelector("main textarea");
											if (!field) return "no field to fill";
											const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
											setValue.call(field, "Een website");
											field.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(200);
											const make = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Make the PDF");
											if (!make) return "no make-the-PDF action";
											make.click();
											for (let tries = 0; tries < 40 && !document.querySelector("[role=dialog]"); tries++) await wait(150);
											const dialog = document.querySelector("[role=dialog]");
											if (!dialog) return "no question about a client once the PDF was made";
											return "ok";
										})()`,
									)) as string;
									if (paperUse !== "ok") throw new Error(`Smoke: using a document template on paper ${paperUse}`);
									writeFileSync(joinPath(shotDir, `use-document-template-paper.png`), (await capture(window.webContents)).toPNG());
									const paperLeft = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const dialog = document.querySelector("[role=dialog]");
											const connect = [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Connect a client");
											if (!connect) return "the question has no way to connect a client";
											connect.click();
											await wait(400);
											if (![...document.querySelectorAll("label")].some((el) => el.textContent.trim().startsWith("Client"))) return "no client step";
											const leave = () => {
												const b = [...document.querySelectorAll("button")].find((el) => ["Previous", "Cancel"].includes(el.textContent.trim()));
												if (b) b.click();
												return Boolean(b);
											};
											for (let step = 0; step < 3; step++) {
												leave();
												await wait(400);
											}
											const back = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Back");
											if (back) back.click();
											await wait(500);
											return document.querySelector("main ul li button") ? "ok" : "did not return to the list";
										})()`,
									)) as string;
									if (paperLeft !== "ok") throw new Error(`Smoke: leaving the document template on paper ${paperLeft}`);

									// Seventy paragraphs on one A4 page run past its foot: the editor
									// says so, flows them onto the pages after it when asked, and draws
									// the picture the template keeps from Juno's own origin.
									const flowed = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const row = [...document.querySelectorAll("main ul li button")].find((el) => el.textContent.includes("Lange tekst op papier"));
											if (!row) return "no row for the long template";
											row.click();
											await wait(700);
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											for (let tries = 0; tries < 20 && !document.querySelector("[data-canvas-content]"); tries++) await wait(150);
											const picture = document.querySelector("[data-canvas-content] img");
											if (!picture) return "the kept picture is not on the canvas";
											for (let tries = 0; tries < 20 && !picture.complete; tries++) await wait(100);
											if (!picture.src.startsWith("app://asset/template/") || picture.naturalWidth !== 1) return "the kept picture did not load: " + picture.src;
											let flow = null;
											for (let tries = 0; tries < 20 && !flow; tries++) {
												await wait(150);
												flow = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Flow onto the next pages");
											}
											if (!flow) return "no warning that the page runs past the paper";
											flow.click();
											for (let tries = 0; tries < 60 && document.querySelector("[role=status]"); tries++) await wait(150);
											if (document.querySelector("[role=status]")) return "a page still runs past the paper after the flow";
											const pages = document.body.textContent.match(/(\\d+) pages/);
											if (!pages || Number(pages[1]) < 2) return "the text was not flowed onto more pages";
											return "ok";
										})()`,
									)) as string;
									if (flowed !== "ok") throw new Error(`Smoke: flowing a document onto pages ${flowed}`);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
										await new Promise((r) => setTimeout(r, 400));
										writeFileSync(joinPath(shotDir, `document-template-paper-flowed-${theme}.png`), (await capture(window.webContents)).toPNG());
									}
									// Leaves the flow unsaved: Escape lets go of nothing and goes back.
									await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await wait(500);
											const back = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Back");
											if (back) back.click();
											await wait(500);
										})()`,
									);
								}
								if (screen === "Mail templates") {
									// One document underneath every view (docs/editors.md section 2):
									// switching to Code has to show the very text the body was
									// rendering, not a blank editor or a stale one. Then onto a
									// canvas, because the template the walk made is hand-written HTML and
									// converting one is the only way the canvas is reached at all: a
									// fresh install ships only the example, and that one is a canvas.
									const edited = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											// The editor loads the template before it paints anything, so
											// this waits for the panel rather than guessing at how long
											// a cold read of the row takes.
											const until = async (find) => {
												for (let tries = 0; tries < 20; tries++) {
													const found = find();
													if (found) return found;
													await wait(150);
												}
												return null;
											};
											if (!(await until(() => document.querySelector('button[aria-label="Hide the panel"]')))) return "no editor panel";
											const visual = await until(() => document.querySelector('[aria-label="Message body"]'));
											if (!visual) return "no visual editor";
											const visualText = visual.textContent.trim();
											if (!visualText) return "the visual editor is empty";
											const codeView = document.querySelector('button[title="The HTML under it"]');
											if (!codeView) return "no code view";
											codeView.click();
											await wait(400);
											const code = document.querySelector('[aria-label="Body HTML"]');
											if (!code) return "no code editor";
											if (!code.textContent.includes(visualText.slice(0, 20))) return "the code view does not show the same body";
											const bodyView = document.querySelector('button[title="The body"]');
											if (!bodyView) return "no body view";
											bodyView.click();
											await wait(300);
											const convert = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Lay this out on a canvas");
											if (!convert) return "no way onto a canvas";
											convert.click();
											await wait(800);
											if (![...document.querySelectorAll("h3")].some((el) => el.textContent.trim() === "Breakpoints")) return "no breakpoints in the panel";
											if (!document.querySelector('button[aria-label="Drag to change the height of the sheet"]')) return "no height handle";
											const addText = document.querySelector('button[aria-label="Add text"]');
											if (!addText) return "no insert bar";
											addText.click();
											await wait(400);
											// A new text opens for typing with its words selected, so what is
											// typed replaces them, the way Figma's text tool works.
											const typing = document.querySelector('[role=textbox][aria-label="Text"]');
											if (!typing || document.activeElement !== typing) return "a new text block did not open for typing";
											document.execCommand("insertText", false, "Welkom");
											typing.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await wait(300);
											if (document.querySelector('[role=textbox][aria-label="Text"]')) return "Escape did not close the new text";
											if (!document.querySelector('button[aria-label="Hide Welkom"]')) return "what was typed did not replace the placeholder";
											if (!document.querySelector('select[aria-label="Width resizing"]')) return "the design panel did not follow the selection";

											// Type from the panel, checked on what the canvas actually draws
											// rather than on the control that was pressed.
											const familyLabel = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === "Font family");
											const family = familyLabel ? document.getElementById(familyLabel.htmlFor) : null;
											if (!family) return "no typography panel";
											const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
											setValue.call(family, "Georgia");
											family.dispatchEvent(new Event("change", { bubbles: true }));
											await wait(300);
											const italic = document.querySelector('button[aria-label="Italic"]');
											if (!italic) return "no italic toggle";
											italic.click();
											await wait(300);
											const textBlocks = () => [...document.querySelectorAll('[title="Double-click to edit the text"]')];
											const block = textBlocks().pop();
											if (!block) return "the text block is not on the canvas";
											const drawn = getComputedStyle(block);
											if (!drawn.fontFamily.includes("Georgia")) return "the canvas did not take the font";
											if (drawn.fontStyle !== "italic") return "the canvas did not take the italic";

											// The eye: a hidden layer leaves the canvas and comes back.
											const shownBefore = textBlocks().length;
											const hide = document.querySelector('button[aria-label="Hide Welkom"]');
											if (!hide) return "no eye on the layer";
											hide.click();
											await wait(300);
											if (textBlocks().length !== shownBefore - 1) return "hiding a layer left it on the canvas";
											const show = document.querySelector('button[aria-label="Show Welkom"]');
											if (!show) return "a hidden layer has no way back";
											show.click();
											await wait(300);
											if (textBlocks().length !== shownBefore) return "showing a layer did not bring it back";

											// In place, the way a text layer is edited in Figma.
											const target = textBlocks().pop();
											const box = target.getBoundingClientRect();
											target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: box.left + 4, clientY: box.top + 4 }));
											await wait(400);
											if (!document.querySelector('[role=toolbar][aria-label="Text format"]')) return "no format bar while editing";
											if (!document.querySelector('[role=textbox][aria-label="Text"]')) return "the text did not open for editing";
											return "ok";
										})()`,
									)) as string;
									if (edited !== "ok") throw new Error(`Smoke: mail template editor ${edited}`);

									const inlineImage = await capture(window.webContents);
									writeFileSync(
										joinPath(shotDir, `mail-template-inline-edit.png`),
										inlineImage.toPNG(),
									);

									// Escape in the text closes the text and nothing else: the block
									// stays selected, so the panel is still pointed at it below.
									const closedText = (await window.webContents.executeJavaScript(
										`(async () => {
											const editor = document.querySelector('[role=textbox][aria-label="Text"]');
											if (!editor) return "the text editor went away early";
											editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 300));
											if (document.querySelector('[role=textbox][aria-label="Text"]')) return "Escape did not close the text";
											if (!document.querySelector('select[aria-label="Width resizing"]')) return "Escape in the text let go of the block";
											return "ok";
										})()`,
									)) as string;
									if (closedText !== "ok")
										throw new Error(`Smoke: mail template editor ${closedText}`);

									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 400));
										const image = await capture(window.webContents);
										writeFileSync(
											joinPath(shotDir, `mail-template-editor-${theme}.png`),
											image.toPNG(),
										);
									}

									// Resizing is Figma's and it is what the canvas draws: the block is
									// the element the section lays out, so a width of 100 is a box 100
									// wide, outlined as one, not a line across the frame. Then the
									// keyboard: duplicate, delete, undo, a tool key, and the list.
									const resized = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const drawn = () => [...document.querySelectorAll('[title="Double-click to edit the text"]')].find((el) => el.textContent.trim() === "Welkom");
											const block = drawn();
											if (!block) return "no Welkom block";
											block.click();
											await wait(200);
											const section = block.parentElement;
											const mode = () => document.querySelector('select[aria-label="Width resizing"]');
											if (!mode()) return "no width resizing";
											if ([...mode().options].map((option) => option.value).join(",") !== "fixed,hug,fill") return "the width modes are not all there";
											const setMode = async (value) => {
												const select = mode();
												Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
												select.dispatchEvent(new Event("change", { bubbles: true }));
												await wait(300);
											};
											await setMode("hug");
											if (drawn().offsetWidth >= section.clientWidth - 48) return "hugging did not shrink the block to its text";
											const label = document.querySelector('label[title="Width"]');
											const width = label ? document.getElementById(label.htmlFor) : null;
											if (!width) return "no width field";
											if (Number(width.value) !== drawn().offsetWidth) return "the width field does not say how wide the block is drawn";
											const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											width.focus();
											setValue.call(width, "100");
											width.dispatchEvent(new Event("input", { bubbles: true }));
											width.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
											width.blur();
											await wait(300);
											if (drawn().offsetWidth !== 100) return "a width of 100 is not drawn 100 wide";
											if (mode().value !== "fixed") return "typing a width did not make it fixed";
											if (!getComputedStyle(drawn()).outlineStyle.includes("solid")) return "the selection is not outlined on the block itself";
											return "ok";
										})()`,
									)) as string;
									if (resized !== "ok") throw new Error(`Smoke: mail template editor ${resized}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-fixed-width.png`),
										(await capture(window.webContents)).toPNG(),
									);

									const filled = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const drawn = () => [...document.querySelectorAll('[title="Double-click to edit the text"]')].find((el) => el.textContent.trim() === "Welkom");
											const section = drawn().parentElement;
											const select = document.querySelector('select[aria-label="Width resizing"]');
											Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "fill");
											select.dispatchEvent(new Event("change", { bubbles: true }));
											await wait(300);
											if (Math.abs(drawn().offsetWidth - (section.clientWidth - parseFloat(getComputedStyle(section).paddingLeft) - parseFloat(getComputedStyle(section).paddingRight))) > 1) return "fill did not stretch the block across its section";
											return "ok";
										})()`,
									)) as string;
									if (filled !== "ok") throw new Error(`Smoke: mail template editor ${filled}`);

									// A breakpoint: the canvas is drawn at its width, a change made
									// there stays there, and the default is untouched by it.
									const narrowed = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const drawn = () => [...document.querySelectorAll('[title="Double-click to edit the text"]')].find((el) => el.textContent.trim() === "Welkom");
											const sheet = () => {
												const handle = document.querySelector('button[aria-label="Drag to change the height of the sheet"]');
												return handle ? handle.parentElement.firstElementChild.textContent.trim() : "";
											};
											const row = (name) => [...document.querySelectorAll("button[aria-pressed]")].find((el) => el.textContent.trim() === name);
											const add = document.querySelector('button[aria-label="Add a breakpoint"]');
											if (!add) return "no way to add a breakpoint";
											add.click();
											await wait(400);
											if (!/^Phone 480 x/.test(sheet())) return "the canvas is not drawn at the new breakpoint: " + sheet();
											if (!drawn()) return "the block is not on the canvas at the breakpoint";
											const sizeLabel = document.querySelector('label[title="Font size"]');
											const size = sizeLabel ? document.getElementById(sizeLabel.htmlFor) : null;
											if (!size) return "no font size at the breakpoint";
											size.focus();
											Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(size, "12");
											size.dispatchEvent(new Event("input", { bubbles: true }));
											size.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
											size.blur();
											await wait(300);
											if (getComputedStyle(drawn()).fontSize !== "12px") return "a size set at the breakpoint is not on its canvas";
											row("Default").click();
											await wait(300);
											if (getComputedStyle(drawn()).fontSize === "12px") return "a change at the breakpoint reached the default";
											if (!/^Default /.test(sheet())) return "the default is not drawn at its own width: " + sheet();
											row("Phone").click();
											await wait(300);
											if (getComputedStyle(drawn()).fontSize !== "12px") return "the breakpoint lost its change";
											return "ok";
										})()`,
									)) as string;
									if (narrowed !== "ok") throw new Error(`Smoke: mail template editor ${narrowed}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-breakpoint.png`),
										(await capture(window.webContents)).toPNG(),
									);

									// What is sent: the canvas with nothing around it, and the
									// breakpoint as a media query in its head.
									const sent = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const view = document.querySelector('button[title="The message as it will be sent"]');
											if (!view) return "no preview view";
											view.click();
											let frame = null;
											for (let tries = 0; tries < 30 && !frame; tries++) {
												await wait(150);
												frame = document.querySelector('iframe[title="Template preview"]');
											}
											if (!frame) return "the message did not render";
											const html = frame.getAttribute("srcdoc") || "";
											if (!html.includes("data-juno-canvas")) return "the preview is not the canvas";
											if (html.includes("border-top:3px")) return "the canvas is still sent in the house frame";
											if (!html.includes("@media only screen and (max-width:480px)")) return "the breakpoint is not in the message";
											if (!document.querySelector('[role=group][aria-label="Preview width"]')) return "the preview has no breakpoints to look at";
											return "ok";
										})()`,
									)) as string;
									if (sent !== "ok") throw new Error(`Smoke: mail template editor ${sent}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-sent.png`),
										(await capture(window.webContents)).toPNG(),
									);

									// A colour the way Figma picks one, on the default again.
									const picked = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const canvas = document.querySelector('button[title="The canvas"]');
											if (!canvas) return "no canvas view";
											canvas.click();
											await wait(400);
											const row = [...document.querySelectorAll("button[aria-pressed]")].find((el) => el.textContent.trim() === "Default");
											if (!row) return "no default breakpoint";
											row.click();
											await wait(300);
											const addFill = document.querySelector('button[aria-label="Add fill"]');
											if (!addFill) return "no way to add a fill";
											addFill.click();
											await wait(300);
											const swatch = document.querySelector('button[aria-label="Pick fill"]');
											if (!swatch) return "the fill has no swatch";
											swatch.click();
											await wait(300);
											const picker = document.querySelector('[role=dialog][aria-label="Fill"]');
											if (!picker) return "the swatch did not open a picker";
											if (picker.querySelectorAll("[role=slider]").length !== 3) return "the picker has no square, hue and opacity";
											return "ok";
										})()`,
									)) as string;
									if (picked !== "ok") throw new Error(`Smoke: mail template editor ${picked}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-color-picker.png`),
										(await capture(window.webContents)).toPNG(),
									);
									const closedPicker = (await window.webContents.executeJavaScript(
										`(async () => {
											document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
											await new Promise((r) => setTimeout(r, 300));
											if (document.querySelector('[role=dialog][aria-label="Fill"]')) return "Escape did not close the picker";
											if (!document.querySelector('select[aria-label="Width resizing"]')) return "Escape in the picker let go of the block";
											return "ok";
										})()`,
									)) as string;
									if (closedPicker !== "ok")
										throw new Error(`Smoke: mail template editor ${closedPicker}`);

									const keyed = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const layerRows = () => [...document.querySelectorAll('button[title="Drag to reorder. Alt and an arrow move it too"]')];
											const blockRows = () => layerRows().filter((el) => el.dataset.layerKind === "block");
											const press = async (key, code, mods = {}) => {
												document.body.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }));
												await wait(300);
											};
											if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
											const start = blockRows().length;
											const welkom = () => blockRows().filter((el) => el.textContent.trim() === "Welkom").length;
											await press("d", "KeyD", { ctrlKey: true });
											if (blockRows().length !== start + 1 || welkom() !== 2) return "Ctrl+D did not duplicate the block";
											await press("Delete", "Delete");
											if (blockRows().length !== start) return "Delete did not remove the selected block";
											await press("z", "KeyZ", { ctrlKey: true });
											if (blockRows().length !== start + 1) return "Ctrl+Z did not bring the deleted block back";
											await press("z", "KeyZ", { ctrlKey: true });
											if (blockRows().length !== start || welkom() !== 1) return "a second Ctrl+Z did not undo the duplicate";
											await press("Z", "KeyZ", { ctrlKey: true, shiftKey: true });
											if (blockRows().length !== start + 1) return "Ctrl+Shift+Z did not redo";
											await press("z", "KeyZ", { ctrlKey: true });
											await press("t", "KeyT");
											const typing = document.querySelector('[role=textbox][aria-label="Text"]');
											if (!typing || document.activeElement !== typing) return "T did not add a text open for typing";
											typing.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await wait(300);
											if (blockRows().length !== start + 1) return "T did not add a block";
											await press("Backspace", "Backspace");
											if (blockRows().length !== start) return "Backspace did not remove the new block";
											await press("?", "Slash", { shiftKey: true });
											if (!document.querySelector('[role=region][aria-label="Keyboard shortcuts"]')) return "? did not open the list of shortcuts";
											return "ok";
										})()`,
									)) as string;
									if (keyed !== "ok") throw new Error(`Smoke: mail template editor ${keyed}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-shortcuts.png`),
										(await capture(window.webContents)).toPNG(),
									);
									await window.webContents.executeJavaScript(
										`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 300));

									// The toolbar floats over the canvas, a layer moves with Alt and an
									// arrow, and "Convert to HTML" turns the block that was just styled
									// into code the canvas draws exactly as it drew the block.
									const converted = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											if (!document.querySelector('[role=toolbar][aria-label="Canvas tools"]')) return "no floating toolbar";
											const layerRows = () => [...document.querySelectorAll('button[title="Drag to reorder. Alt and an arrow move it too"]')];
											const blockRows = () => layerRows().filter((el) => el.dataset.layerKind === "block");
											if (document.querySelector('[role=region][aria-label="Keyboard shortcuts"]')) return "Escape did not close the list of shortcuts";
											const tekst = blockRows().find((el) => el.textContent.trim() === "Welkom");
											if (!tekst) return "no layer for the text block";
											tekst.click();
											await wait(200);
											const before = blockRows().map((el) => el.textContent.trim());
											tekst.focus();
											tekst.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
											await wait(300);
											const after = blockRows().map((el) => el.textContent.trim());
											if (after.indexOf("Welkom") !== before.indexOf("Welkom") - 1) return "Alt and an arrow did not move the layer";
											const moved = blockRows().find((el) => el.textContent.trim() === "Welkom");
											moved.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
											await wait(300);
											if (blockRows().map((el) => el.textContent.trim()).join("|") !== before.join("|")) return "the layer did not move back";

											const convert = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Convert to HTML");
											if (!convert) return "no Convert to HTML";
											convert.click();
											for (let tries = 0; tries < 20 && document.querySelector('select[aria-label="Width resizing"]'); tries++) await wait(150);
											if (document.querySelector('select[aria-label="Width resizing"]')) return "the panel still shows the design controls";
											const field = (text) => {
												const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === text);
												return label ? document.getElementById(label.htmlFor) : null;
											};
											const html = field("HTML");
											const css = field("CSS");
											if (!html || !css) return "no HTML and CSS fields";
											if (!html.value.includes("Welkom")) return "the HTML field does not hold the block";
											if (!css.value.includes("font-style:italic")) return "the CSS field does not hold the block's style";
											// A text block converts to the paragraph it was sent as.
											const drawn = [...document.querySelectorAll("main p")].find((el) => el.textContent.trim() === "Welkom" && el.children.length === 0);
											if (!drawn) return "the converted block is not on the canvas";
											const style = getComputedStyle(drawn);
											if (!style.fontFamily.includes("Georgia") || style.fontStyle !== "italic") return "the converted block does not look the same";
											return "ok";
										})()`,
									)) as string;
									if (converted !== "ok") throw new Error(`Smoke: mail template editor ${converted}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-code-block.png`),
										(await capture(window.webContents)).toPNG(),
									);

									// A container nests inside another (docs/editors.md section 2): F
									// while a container is selected lands the new one inside it. A
									// block added the same way lands in the nested
									// section, the layers show the nesting by depth, Alt and an arrow
									// still moves a block within its own parent, and the compiled message
									// carries the nesting through to a second `<section>`.
									const nested = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const press = async (key, code) => {
												document.body.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }));
												await wait(300);
											};
											const type = async (text) => {
												const editor = document.querySelector('[role=textbox][aria-label="Text"]');
												if (!editor) return false;
												document.execCommand("insertText", false, text);
												editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
												await wait(300);
												return true;
											};
											const containerRows = () => [...document.querySelectorAll('[data-layer-kind="container"]')];
											const blockRows = () => [...document.querySelectorAll('[data-layer-kind="block"]')];

											const top = containerRows().find((el) => el.dataset.layerDepth === "0");
											if (!top) return "no top-level container in the layers";
											top.click();
											await wait(200);
											const containersBefore = containerRows().length;
											await press("f", "KeyF");
											if (containerRows().length !== containersBefore + 1) return "F did not add a nested section";
											const nestedRow = containerRows().find((el) => el !== top && el.dataset.layerDepth !== "0");
											if (!nestedRow) return "the new section is not nested under the top-level one";

											const blocksBefore = blockRows().length;
											await press("t", "KeyT");
											if (!(await type("Genest"))) return "T did not open a new text for typing";
											if (blockRows().length !== blocksBefore + 1) return "T did not add a block";
											const first = blockRows().find((el) => el.textContent.trim() === "Genest");
											if (!first) return "the new block is not in the layers";
											if (first.dataset.layerDepth !== String(Number(nestedRow.dataset.layerDepth) + 1)) {
												return "the new block did not land inside the nested section";
											}

											// A second block beside the first, so Alt and an arrow has
											// something to reorder within that same parent.
											first.click();
											await wait(200);
											await press("t", "KeyT");
											if (!(await type("Tweede"))) return "T did not open a second text for typing";
											const second = blockRows().find((el) => el.textContent.trim() === "Tweede");
											if (!second || second.dataset.layerDepth !== first.dataset.layerDepth) {
												return "the second block did not land beside the first, in the same parent";
											}
											const siblings = () =>
												blockRows()
													.filter((el) => el.dataset.layerDepth === first.dataset.layerDepth)
													.map((el) => el.textContent.trim());
											const before = siblings();
											second.focus();
											second.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
											await wait(300);
											const after = siblings();
											if (after.indexOf("Tweede") !== before.indexOf("Tweede") - 1) {
												return "Alt and an arrow did not move the block within its nested parent";
											}

											// An apostrophe and an ampersand typed into a text go into the
											// message escaped once, and read as the same words again.
											second.click();
											await wait(200);
											await press("t", "KeyT");
											if (!(await type("Apostrof's & meer"))) return "T did not open a third text for typing";

											const view = document.querySelector('button[title="The message as it will be sent"]');
											if (!view) return "no preview view";
											view.click();
											// The frame may already exist from an earlier look at the
											// preview, so wait for its document to carry these edits
											// rather than for the frame itself.
											let html = "";
											for (let tries = 0; tries < 40; tries++) {
												await wait(150);
												const frame = document.querySelector('iframe[title="Template preview"]');
												html = frame ? frame.getAttribute("srcdoc") || "" : "";
												if (html.includes("Genest") && html.includes("Tweede") && html.includes("Apostrof")) break;
											}
											if (!html) return "the message did not render";
											if (!html.includes("Genest") || !html.includes("Tweede")) return "the compiled HTML does not carry the nested blocks";
											if (!html.includes("Apostrof&#39;s &amp; meer") || /&amp;#|&amp;amp;/.test(html)) return "an apostrophe or an ampersand was not escaped exactly once";
											// A section opened inside another before that one closes.
											if (!/<section[^>]*>(?:(?!<\\/section>)[\\s\\S])*<section/.test(html)) {
												return "the compiled HTML has no section nested inside another";
											}
											const canvasView = document.querySelector('button[title="The canvas"]');
											if (canvasView) {
												canvasView.click();
												await wait(300);
											}
											return "ok";
										})()`,
									) as string;
									if (nested !== "ok") throw new Error(`Smoke: mail template editor ${nested}`);
									writeFileSync(joinPath(shotDir, `mail-template-nested.png`), (await capture(window.webContents)).toPNG());

									// The toolbar's groups (TODO 4a). Every group has a button that adds
									// its last-used element and a chevron that opens its menu; both are
									// used here on the real toolbar, and so are the keys: a group's letter,
									// Shift with it for the menu, and an element's own key inside it. A
									// text is nested in a header, and the compiled message follows what
									// is added and what is changed in the design panel.
									// A screenshot in the theme the walk is in (dark, after the two
									// above) and in light, and back to dark: the new controls have to be
									// looked at in both.
									const shootBoth = async (name: string) => {
										writeFileSync(joinPath(shotDir, `${name}.png`), (await capture(window.webContents)).toPNG());
										for (const theme of ["light", "dark"] as const) {
											nativeTheme.themeSource = theme;
											await window.webContents.executeJavaScript(
												`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
											);
											await new Promise((r) => setTimeout(r, 400));
											if (theme === "light") writeFileSync(joinPath(shotDir, `${name}-light.png`), (await capture(window.webContents)).toPNG());
										}
									};

									const grouped = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const press = async (key, code, mods = {}, target = document.body) => {
												target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }));
												await wait(300);
											};
											const rows = (kind) => [...document.querySelectorAll('[data-layer-kind="' + kind + '"]')];
											const named = (kind, start) => rows(kind).find((el) => el.textContent.trim().startsWith(start));
											const type = async (text) => {
												const editor = document.querySelector("[role=textbox]");
												if (!editor) return false;
												document.execCommand("insertText", false, text);
												editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
												await wait(300);
												return true;
											};
											const compiled = async (has) => {
												document.querySelector('button[title="The message as it will be sent"]').click();
												let html = "";
												for (let tries = 0; tries < 40; tries++) {
													await wait(150);
													const frame = document.querySelector('iframe[title="Template preview"]');
													html = frame ? frame.getAttribute("srcdoc") || "" : "";
													if (has(html)) break;
												}
												document.querySelector('button[title="The canvas"]').click();
												await wait(300);
												return html;
											};
											const setSelect = async (labelText, value) => {
												const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === labelText);
												const select = label ? document.getElementById(label.htmlFor) : null;
												if (!select) return false;
												Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
												select.dispatchEvent(new Event("change", { bubbles: true }));
												await wait(300);
												return true;
											};
											const openMenu = async (group) => {
												const chevron = document.querySelector('button[aria-label="' + group + ' menu"]');
												if (!chevron) return false;
												chevron.click();
												await wait(300);
												return document.querySelector('[role=menu][aria-label="' + group + ' menu"]') !== null;
											};
											const pick = async (id) => {
												const item = document.querySelector('[role=menuitem][data-element="' + id + '"]');
												if (!item) return false;
												item.click();
												await wait(300);
												return true;
											};

											for (const [group, name] of [["containers", "Containers"], ["text", "Text"], ["columns", "Columns"], ["media", "Media"], ["other", "Other"]]) {
												if (!document.querySelector('[data-tool-group="' + group + '"] button')) return "the toolbar has no " + name + " group";
												if (!document.querySelector('button[aria-label="' + name + ' menu"]')) return "the " + name + " group has no chevron";
											}

											// Containers: the key adds the last-used one, and Shift and F opens
											// the menu, where H is a header.
											const top = rows("container").find((el) => el.dataset.layerDepth === "0");
											if (!top) return "no top-level container to start from";
											top.click();
											await wait(200);
											const containers = rows("container").length;
											await press("f", "KeyF");
											if (rows("container").length !== containers + 1) return "F did not add a container";
											await press("F", "KeyF", { shiftKey: true });
											const menu = document.querySelector('[role=menu][aria-label="Containers menu"]');
											if (!menu) return "Shift+F did not open the Containers menu";
											if (!menu.contains(document.activeElement)) return "the menu did not take the focus";
											if (menu.querySelectorAll("[role=menuitem]").length !== 8) return "the Containers menu does not list its eight elements";
											const keys = [...menu.querySelectorAll("kbd")].map((el) => el.textContent.trim()).join("");
											if (keys !== "SDHFMAIN") return "the rows of the Containers menu do not show their keys: " + keys;
											await press("H", "KeyH", { shiftKey: true }, document.activeElement);
											if (document.querySelector("[role=menu]")) return "picking an element did not close the menu";
											if (rows("container").length !== containers + 2) return "H in the Containers menu did not add a header";
											const header = named("container", "Header");
											if (!header) return "the new header is not in the layers under its name";
											if (!header.textContent.includes("header")) return "the layers do not show the header tag";

											// A text in the header. A letter typed into the open text belongs to
											// the text, not to the toolbar.
											const blocks = () => rows("block");
											await press("t", "KeyT");
											const typing = document.querySelector('[role=textbox][aria-label="Text"]');
											if (!typing || document.activeElement !== typing) return "T did not add a text open for typing";
											const beforeTyping = rows("container").length;
											typing.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true, cancelable: true }));
											await wait(300);
											if (rows("container").length !== beforeTyping) return "a letter typed into a text added a container";
											if (!(await type("In de kop"))) return "the text closed early";
											const kop = blocks().find((el) => el.textContent.trim().startsWith("In de kop"));
											if (!kop) return "the text is not in the layers";
											if (kop.dataset.layerDepth !== String(Number(named("container", "Header").dataset.layerDepth) + 1)) {
												return "the text is not nested in the header";
											}
											const nestedHtml = await compiled((html) => html.includes("In de kop"));
											if (!/<header[^>]*>(?:(?!<\\/header>)[\\s\\S])*In de kop/.test(nestedHtml)) return "the compiled HTML has no header holding the text";

											// Text: the chevron and its menu, and the button that remembers.
											if (!(await openMenu("Text"))) return "the Text chevron did not open its menu";
											if (document.querySelectorAll("[role=menuitem]").length !== 14) return "the Text menu does not list its fourteen elements";
											if (!document.querySelector('[role=menuitem][data-element="button"]')) return "the Text menu has no Button";
											if (document.querySelector('button[aria-label="Add button"]')) return "the toolbar still has a Button tool of its own";
											if (!(await pick("h3"))) return "no Heading 3 in the Text menu";
											if (!(await type("Kopje"))) return "a new heading did not open for typing";
											const remembered = document.querySelector('[data-tool-group="text"] button').getAttribute("aria-label");
											if (remembered !== "Add heading 3") return "the Text button did not take the last-used element: " + remembered;
											const headingHtml = await compiled((html) => html.includes("Kopje"));
											if (!/<h3[^>]*>Kopje<\\/h3>/.test(headingHtml)) return "the compiled HTML has no h3";
											let stored = "";
											try { stored = window.localStorage.getItem("juno.mailTemplates.lastElements") || ""; } catch { stored = ""; }
											if (!stored.includes('"text":"h3"')) return "the last-used element was not remembered on this machine";

											// A tag changed in the design panel, within its group.
											blocks().find((el) => el.textContent.trim().startsWith("In de kop")).click();
											await wait(300);
											if (!(await setSelect("Text element", "blockquote"))) return "no Text element list in the design panel";
											const quote = await compiled((html) => html.includes("<blockquote"));
											if (!/<blockquote[^>]*>In de kop<\\/blockquote>/.test(quote)) return "changing the tag to blockquote did not reach the compiled HTML";
											if (!(await setSelect("Text element", "h4"))) return "no Text element list after the first change";
											const asHeading = await compiled((html) => html.includes("<h4"));
											if (!/<h4[^>]*>In de kop<\\/h4>/.test(asHeading)) return "a text turned into a heading did not compile as one";
											if (!(await setSelect("Text element", "ul"))) return "no Text element list after the second change";
											const asList = await compiled((html) => html.includes("<ul"));
											if (!/<ul[^>]*><li>In de kop<\\/li><\\/ul>/.test(asList)) return "a heading turned into a list did not compile as one";
											const kept = blocks().filter((el) => el.textContent.trim().startsWith("In de kop")).length;
											if (kept !== 1) return "changing the tag lost or copied the element";

											named("container", "Header").click();
											await wait(300);
											if (!(await setSelect("Container element", "footer"))) return "no Container element list in the design panel";
											const footerHtml = await compiled((html) => html.includes("<footer"));
											if (!/<footer[^>]*>(?:(?!<\\/footer>)[\\s\\S])*In de kop/.test(footerHtml)) return "changing the container to a footer did not reach the compiled HTML";
											if (/<header/.test(footerHtml)) return "the header is still sent as a header";
											if (!named("container", "Footer")) return "the layers still call the footer a header";

											// A list opens for typing like a text does, and what is typed stays
											// an item of it.
											await press("T", "KeyT", { shiftKey: true });
											if (!document.querySelector('[role=menu][aria-label="Text menu"]')) return "Shift+T did not open the Text menu";
											await press("U", "KeyU", { shiftKey: true }, document.activeElement);
											if (!(await type("Eerste punt"))) return "a new list did not open for typing";
											const listHtml = await compiled((html) => html.includes("Eerste punt"));
											if (!/<ul[^>]*><li>Eerste punt<\\/li><\\/ul>/.test(listHtml)) return "what was typed into a new list is not an item of it";
											return "ok";
										})()`,
									) as string;
									if (grouped !== "ok") throw new Error(`Smoke: mail template editor ${grouped}`);
									await shootBoth("mail-template-grouped");

									// Columns: added from the key and from the menu, with a cell chosen
									// as the place a new text lands, and rows and cells changed in the
									// design panel.
									const columned = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const press = async (key, code, mods = {}, target = document.body) => {
												target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }));
												await wait(300);
											};
											const rows = (kind) => [...document.querySelectorAll('[data-layer-kind="' + kind + '"]')];
											const type = async (text) => {
												const editor = document.querySelector("[role=textbox]");
												if (!editor) return false;
												document.execCommand("insertText", false, text);
												editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
												await wait(300);
												return true;
											};
											const compiled = async (has) => {
												document.querySelector('button[title="The message as it will be sent"]').click();
												let html = "";
												for (let tries = 0; tries < 40; tries++) {
													await wait(150);
													const frame = document.querySelector('iframe[title="Template preview"]');
													html = frame ? frame.getAttribute("srcdoc") || "" : "";
													if (has(html)) break;
												}
												document.querySelector('button[title="The canvas"]').click();
												await wait(300);
												return html;
											};
											const setNumber = async (title, value) => {
												const label = document.querySelector('label[title="' + title + '"]');
												const field = label ? document.getElementById(label.htmlFor) : null;
												if (!field) return false;
												field.focus();
												Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
												field.dispatchEvent(new Event("input", { bubbles: true }));
												field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
												field.blur();
												await wait(300);
												return true;
											};

											await press("c", "KeyC");
											if (rows("columns").length !== 1) return "C did not add a columns table";
											if (rows("cell").length !== 2) return "a new columns table does not have two cells";
											const chevron = document.querySelector('button[aria-label="Columns menu"]');
											chevron.click();
											await wait(300);
											const item = document.querySelector('[role=menuitem][data-element="columns"]');
											if (!item) return "the Columns menu has no columns";
											item.click();
											await wait(300);
											if (rows("columns").length !== 2 || rows("cell").length !== 4) return "the Columns menu did not add a second table";
											const tables = await compiled((html) => (html.match(/data-juno-columns/g) || []).length === 2);
											if (!/<table[^>]*role="presentation"[^>]*data-juno-columns/.test(tables)) return "the compiled HTML has no presentation table";

											// A cell: its width, and a text that lands in it.
											const cell = rows("cell")[0];
											cell.click();
											await wait(300);
											if (!(await setNumber("Width", "30"))) return "no width field for a cell";
											const cellHtml = await compiled((html) => html.includes('width="30%"'));
											if (!cellHtml.includes('width="30%"')) return "a cell width set in the design panel is not in the compiled HTML";
											const cellDepth = Number(rows("cell")[0].dataset.layerDepth);
											rows("cell")[0].click();
											await wait(300);
											await press("t", "KeyT");
											if (!(await type("In de cel"))) return "T with a cell selected did not open a text";
											const inCell = rows("block").find((el) => el.textContent.trim().startsWith("In de cel"));
											if (!inCell || Number(inCell.dataset.layerDepth) !== cellDepth + 1) return "a text added with a cell selected did not land in the cell";

											// Rows and cells of the table itself.
											rows("columns")[0].click();
											await wait(300);
											const before = rows("cell").length;
											document.querySelector('button[aria-label="Add row"]').click();
											await wait(300);
											if (rows("cell").length !== before + 2) return "Add row did not add a row of cells";
											document.querySelector('button[aria-label="Remove row 2"]').click();
											await wait(300);
											if (rows("cell").length !== before) return "Remove row did not take the row out";
											document.querySelector('button[aria-label="Add a cell to row 1"]').click();
											await wait(300);
											if (rows("cell").length !== before + 1) return "Add a cell did not add a cell";
											return "ok";
										})()`,
									) as string;
									if (columned !== "ok") throw new Error(`Smoke: mail template editor ${columned}`);
									await shootBoth("mail-template-columns");

									// Media and the rest, then the menu photographed open.
									const media = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const press = async (key, code, mods = {}, target = document.body) => {
												target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }));
												await wait(300);
											};
											const rows = (kind) => [...document.querySelectorAll('[data-layer-kind="' + kind + '"]')];
											const footer = rows("container").find((el) => el.textContent.trim().startsWith("Footer"));
											if (!footer) return "the footer went away";
											footer.click();
											await wait(300);
											const blocks = rows("block").length;
											await press("i", "KeyI");
											if (rows("block").length !== blocks + 1) return "I did not add a picture";
											await press("e", "KeyE");
											if (rows("block").length !== blocks + 2) return "E did not add an input";
											await press("E", "KeyE", { shiftKey: true });
											const other = document.querySelector('[role=menu][aria-label="Other menu"]');
											if (!other) return "Shift+E did not open the Other menu";
											await press("D", "KeyD", { shiftKey: true }, document.activeElement);
											if (rows("block").length !== blocks + 3) return "D in the Other menu did not add a divider";
											const chevron = document.querySelector('button[aria-label="Media menu"]');
											chevron.click();
											await wait(300);
											const menu = document.querySelector('[role=menu][aria-label="Media menu"]');
											if (!menu) return "the Media chevron did not open its menu";
											if (menu.querySelectorAll("[role=menuitem]").length !== 2) return "the Media menu offers more than a picture and a linked picture";
											if (!/no client that matters/.test(menu.textContent)) return "the Media menu does not say why there is no video";
											if (/video|audio|embed/i.test([...menu.querySelectorAll("[role=menuitem]")].map((el) => el.textContent).join(" "))) return "the Media menu offers video, audio or an embed";
											return "ok";
										})()`,
									) as string;
									if (media !== "ok") throw new Error(`Smoke: mail template editor ${media}`);
									await shootBoth("mail-template-groups");

									const linked = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const press = async (key, code, mods = {}, target = document.body) => {
												target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }));
												await wait(300);
											};
											const rows = (kind) => [...document.querySelectorAll('[data-layer-kind="' + kind + '"]')];
											const compiled = async (has) => {
												document.querySelector('button[title="The message as it will be sent"]').click();
												let html = "";
												for (let tries = 0; tries < 40; tries++) {
													await wait(150);
													const frame = document.querySelector('iframe[title="Template preview"]');
													html = frame ? frame.getAttribute("srcdoc") || "" : "";
													if (has(html)) break;
												}
												document.querySelector('button[title="The canvas"]').click();
												await wait(300);
												return html;
											};
											const setText = async (labelText, value) => {
												const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === labelText);
												const field = label ? document.getElementById(label.htmlFor) : null;
												if (!field) return false;
												Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
												field.dispatchEvent(new Event("input", { bubbles: true }));
												await wait(300);
												return true;
											};

											// Escape closes a menu and nothing else.
											await press("Escape", "Escape", {}, document.activeElement);
											if (document.querySelector("[role=menu]")) return "Escape did not close the menu";
											if (!document.querySelector('button[aria-label="Delete block"]')) return "Escape in the menu let go of the selection";

											const blocks = rows("block").length;
											await press("I", "KeyI", { shiftKey: true });
											if (!document.querySelector('[role=menu][aria-label="Media menu"]')) return "Shift+I did not open the Media menu";
											await press("L", "KeyL", { shiftKey: true }, document.activeElement);
											if (rows("block").length !== blocks + 1) return "L in the Media menu did not add a linked picture";
											const remembered = document.querySelector('[data-tool-group="media"] button').getAttribute("aria-label");
											if (remembered !== "Add linked picture") return "the Media button did not take the last-used element: " + remembered;

											// The picture links through an on-click action in the Actions
											// section. A link with a scheme the message refuses is said to be
											// refused, and a safe one is not. The picture has no address of its
											// own here: the canvas would try to load one, and its content policy
											// refuses every address that is not the app's own.
											if (!(await setText("Link address", "http://insecure.example"))) return "no link address field on a picture";
											if (![...document.querySelectorAll("p")].some((el) => el.textContent.startsWith("Only https addresses are kept"))) return "an http link was not shown as refused";
											if (!(await setText("Link address", "https://example.be"))) return "the link field went away";
											if ([...document.querySelectorAll("p")].some((el) => el.textContent.startsWith("Only https addresses are kept"))) return "an https link was shown as refused";
											if (!document.querySelector("[data-layer-linked]")) return "a linked picture has no link glyph in the layers";
											const sent = await compiled((html) => /<hr /.test(html));
											if (sent.includes("insecure.example")) return "an http link reached the message";
											if (!/<hr[^>]*>/.test(sent)) return "the divider is not in the compiled HTML";

											// What the compiler makes of a picture with an address, through the
											// real bridge: inside its link when the link is safe, and a plain
											// picture when it is not.
											const viaBridge = await window.juno.mail.templates.preview({
												subject: "x",
												bodyHtml: "",
												inputs: [],
												clientId: null,
												layout: {
													version: 2,
													children: [
														{
															kind: "container",
															tag: "header",
															children: [
																{ kind: "image", src: "https://example.be/logo.png", alt: "Logo", href: "https://example.be" },
																{ kind: "image", src: "https://example.be/other.png", alt: "Other", href: "javascript:alert(1)" },
																{ kind: "image", src: "https://example.be/plain.png", alt: "Plain", href: "" },
															],
														},
													],
												},
											});
											const pictures = viaBridge.bodyHtml;
											if ((pictures.match(/data-juno-link/g) || []).length !== 1) return "only the picture with a safe link should be inside a link";
											if (!/<a href="https:\\/\\/example.be" data-juno-link="1"[^>]*><img[^>]*logo.png/.test(pictures)) return "the picture is not inside its link in the compiled HTML";
											if (pictures.includes("javascript")) return "an unsafe link reached the message";
											if (!/<header[^>]*>/.test(pictures)) return "the header container is not written as a header";

											// Convert to HTML for a container: the footer and everything in
											// it become one block that is sent as it was.
											const footer = rows("container").find((el) => el.textContent.trim().startsWith("Footer"));
											footer.click();
											await wait(300);
											const containers = rows("container").length;
											const convert = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Convert to HTML");
											if (!convert) return "a container has no Convert to HTML";
											convert.click();
											for (let tries = 0; tries < 20 && rows("container").length === containers; tries++) await wait(150);
											if (rows("container").length !== containers - 1) return "converting the footer left it in the layers as a container";
											if (rows("columns").length !== 0) return "the tables it held are still in the layers";
											const converted = await compiled((html) => html.includes("<footer data-juno-block=\\"html\\""));
											if (!/<footer data-juno-block="html"[^>]*>(?:(?!<\\/footer>)[\\s\\S])*<table[^>]*role="presentation"/.test(converted)) return "the converted footer is not sent as the footer with its table";
											if (!converted.includes("In de kop") || !converted.includes("In de cel")) return "converting lost what was in the footer";
											return "ok";
										})()`,
									) as string;
									if (linked !== "ok") throw new Error(`Smoke: mail template editor ${linked}`);
									writeFileSync(joinPath(shotDir, `mail-template-converted.png`), (await capture(window.webContents)).toPNG());

									// The design panel's sections (TODO 4d): Layout holds only how an
									// element arranges what is in it, Spacing holds padding and margin,
									// the radius sits with the opacity in Appearance, and W and H are
									// with Position. A container is given a margin and a padding from
									// Spacing and a place in the 3 by 3 alignment box, and the compiled
									// message is checked; then a text block, whose Layout is how its words
									// sit, and which has no Clip content.
									const spaced = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const rows = (kind) => [...document.querySelectorAll('[data-layer-kind="' + kind + '"]')];
											const compiled = async (has) => {
												document.querySelector('button[title="The message as it will be sent"]').click();
												let html = "";
												for (let tries = 0; tries < 40; tries++) {
													await wait(150);
													const frame = document.querySelector('iframe[title="Template preview"]');
													html = frame ? frame.getAttribute("srcdoc") || "" : "";
													if (has(html)) break;
												}
												document.querySelector('button[title="The canvas"]').click();
												await wait(300);
												return html;
											};
											const setNumber = async (title, value) => {
												const label = document.querySelector('label[title="' + title + '"]');
												const field = label ? document.getElementById(label.htmlFor) : null;
												if (!field) return false;
												field.focus();
												Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
												field.dispatchEvent(new Event("input", { bubbles: true }));
												field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
												field.blur();
												await wait(300);
												return true;
											};
											const setSelectByLabel = async (aria, value) => {
												const select = document.querySelector('select[aria-label="' + aria + '"]');
												if (!select) return false;
												Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
												select.dispatchEvent(new Event("change", { bubbles: true }));
												await wait(300);
												return true;
											};
											const panel = (title) => {
												const heading = [...document.querySelectorAll("h3")].find((el) => el.textContent.trim() === title);
												return heading ? heading.closest("section") : null;
											};
											const box = () => document.querySelector('[role=group][aria-label="Alignment"]');
											const cell = (name) => box() ? box().querySelector('button[aria-label="' + name + '"]') : null;
											const style = (html, name) => {
												const found = new RegExp('<\\\\w+ data-juno-section="' + name + '"[^>]*style="([^"]*)"').exec(html);
												return found ? found[1] : "";
											};

											// The first container at the top of the layers, named so its
											// style can be found in the compiled message.
											const top = rows("container").find((el) => el.dataset.layerDepth === "0");
											if (!top) return "no top-level container";
											top.click();
											await wait(300);
											const nameField = [...document.querySelectorAll("input")].find((el) => /^(Section|Div|Header|Footer|Main|Article|Aside|Nav) name$/.test(el.getAttribute("aria-label") || ""));
											if (!nameField) return "the container has no name field";
											Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(nameField, "Ruimte");
											nameField.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(300);

											// The sections, in the order every element has them.
											const titles = [...document.querySelectorAll("h3")].map((el) => el.textContent.trim());
											const order = ["Position", "Layout", "Spacing", "Appearance", "Fill", "Stroke", "Effects", "Actions"].map((title) => titles.indexOf(title));
											if (order.some((at, index) => at < 0 || (index > 0 && at < order[index - 1]))) return "the container's sections are not Position, Layout, Spacing, Appearance, Fill, Stroke, Effects, Actions: " + titles.join(", ");
											const position = panel("Position");
											const layoutSection = panel("Layout");
											const spacing = panel("Spacing");
											const appearance = panel("Appearance");
											if (!position.querySelector('label[title="Width"]') || !position.querySelector('label[title="Height"]')) return "W and H are not with Position";
											if (layoutSection.querySelector('label[title="Width"]') || layoutSection.querySelector('label[title="Corner radius"]')) return "Layout still holds the size or the radius";
											if (layoutSection.querySelector('label[title="Padding left and right"]')) return "Layout still holds the padding";
											if (!appearance.querySelector('label[title="Corner radius"]') || !appearance.querySelector('label[title="Opacity"]')) return "the radius is not with the opacity in Appearance";
											if (!spacing.querySelector('label[title="Padding left and right"]') || !spacing.querySelector('label[title="Margin left and right"]')) return "Spacing has no padding and margin";
											if (![...layoutSection.querySelectorAll("label")].some((el) => el.textContent.trim() === "Clip content")) return "a container has no Clip content in Layout";
											if (!box()) return "Layout has no alignment box";
											if (box().querySelectorAll("button").length !== 9) return "the alignment box does not have nine places";

											// Margin and padding from Spacing.
											if (!(await setNumber("Margin top and bottom", "14"))) return "no margin field";
											if (!(await setNumber("Padding left and right", "30"))) return "no padding field";
											let html = await compiled((h) => style(h, "Ruimte").includes("margin-top:14px"));
											let css = style(html, "Ruimte");
											if (!/margin-top:14px;margin-bottom:14px/.test(css)) return "the margin from Spacing is not in the compiled message: " + css;
											if (!/padding:\\d+px 30px \\d+px 30px/.test(css)) return "the padding from Spacing is not in the compiled message: " + css;

											// The 3 by 3 box sets the distribution and the alignment in one click.
											cell("Align middle centre").click();
											await wait(300);
											if (cell("Align middle centre").getAttribute("aria-pressed") !== "true") return "the centre of the box is not pressed after a click on it";
											html = await compiled((h) => style(h, "Ruimte").includes("align-items:center"));
											css = style(html, "Ruimte");
											if (!/justify-content:center;align-items:center/.test(css)) return "the middle centre place did not set both alignments: " + css;
											cell("Align bottom right").click();
											await wait(300);
											html = await compiled((h) => style(h, "Ruimte").includes("flex-end"));
											css = style(html, "Ruimte");
											if (!/justify-content:flex-end;align-items:flex-end/.test(css)) return "the bottom right place did not set both alignments: " + css;

											// Stretch stays reachable and visible, and the Auto gap is space between.
											const stretch = document.querySelector('button[aria-label="Stretch across"]');
											if (!stretch) return "no stretch toggle beside the box";
											stretch.click();
											await wait(300);
											if (document.querySelector('button[aria-label="Stretch across"]').getAttribute("aria-pressed") !== "true") return "the stretch toggle did not turn on";
											if (![...box().querySelectorAll("button")].some((el) => el.dataset.lit === "line")) return "a stretched box does not light the line it leaves";
											html = await compiled((h) => /align-items:stretch/.test(style(h, "Ruimte")));
											if (!/justify-content:flex-end;align-items:stretch/.test(style(html, "Ruimte"))) return "stretch did not reach the compiled message: " + style(html, "Ruimte");
											if (!(await setSelectByLabel("Gap between blocks spacing", "between"))) return "no Auto option on the gap";
											html = await compiled((h) => style(h, "Ruimte").includes("space-between"));
											if (!/justify-content:space-between/.test(style(html, "Ruimte"))) return "the Auto gap did not write space between";
											cell("Align top left").click();
											await wait(300);
											html = await compiled((h) => /align-items:flex-start/.test(style(h, "Ruimte")));
											if (!/justify-content:space-between;align-items:flex-start/.test(style(html, "Ruimte"))) return "a click on the box while the gap is Auto changed the distribution: " + style(html, "Ruimte");

											// A centred container: the margin sides its alignment sets say Auto.
											if (!(await setNumber("Width", "400"))) return "no width field on the container";
											const centre = document.querySelector('[role=group][aria-label="Where it sits across what holds it"] button[title="Align centre"]');
											if (!centre) return "a container in the frame has no place across it once it is narrower";
											centre.click();
											await wait(300);
											const marginPair = document.querySelector('label[title="Margin left and right"]');
											const autoField = marginPair ? document.getElementById(marginPair.htmlFor) : null;
											if (!autoField || !autoField.disabled || autoField.getAttribute("placeholder") !== "Auto") return "a centred container's left and right margins do not say Auto";
											html = await compiled((h) => /margin-left:auto/.test(style(h, "Ruimte")));
											css = style(html, "Ruimte");
											if (!/margin-left:auto;margin-right:auto;margin-top:14px;margin-bottom:14px/.test(css)) return "the auto sides were not kept ahead of the margin: " + css;

											// The canvas draws what the compiler wrote: in the middle, with
											// the margin above it.
											const drawn = document.querySelector('[data-canvas-id][class*="outline-2"]');
											if (!drawn) return "the selected container is not outlined on the canvas";
											const outer = drawn.parentElement.getBoundingClientRect();
											const inner = drawn.getBoundingClientRect();
											if (inner.left - outer.left < 20 || Math.abs(inner.left - outer.left - (outer.right - inner.right)) > 1.5) return "the canvas does not draw a centred container in the middle";
											if (getComputedStyle(drawn).marginTop !== "14px") return "the canvas does not draw the margin: " + getComputedStyle(drawn).marginTop;

											// Back to something a person would keep, for the screenshot.
											if (!(await setSelectByLabel("Gap between blocks spacing", "fixed"))) return "no Fixed option on the gap";
											cell("Align middle centre").click();
											await wait(300);

											// A text: its Layout is how the words sit, Typography no longer
											// holds that, and there is nothing to clip.
											let found = false;
											for (const candidate of rows("block")) {
												candidate.click();
												await wait(250);
												if ([...document.querySelectorAll("label")].some((el) => el.textContent.trim() === "Text element")) {
													found = true;
													break;
												}
											}
											if (!found) return "no text block to look at";
											const textLayout = panel("Layout");
											if (!textLayout || !textLayout.querySelector('[role=group][aria-label="Horizontal alignment"]')) return "a text's Layout has no horizontal alignment";
											if (textLayout.querySelector('label[title="Padding left and right"]') || [...textLayout.querySelectorAll("label")].some((el) => el.textContent.trim() === "Clip content")) return "a text's Layout holds spacing or Clip content";
											if (panel("Typography") && panel("Typography").querySelector('[role=group][aria-label="Horizontal alignment"]')) return "the text alignment is still in Typography";
											if (!panel("Spacing") || !panel("Spacing").querySelector('label[title="Margin top and bottom"]')) return "a text has no margin in Spacing";
											if (!panel("Position").querySelector('label[title="Width"]')) return "a text's W is not with Position";
											const centreText = textLayout.querySelector('[role=group][aria-label="Horizontal alignment"] button[title="Align centre"]');
											centreText.click();
											await wait(300);
											if (centreText.getAttribute("aria-pressed") !== "true") return "the text alignment button did not press";

											// The container is left selected for the picture.
											rows("container").find((el) => el.dataset.layerDepth === "0").click();
											await wait(300);
											return "ok";
										})()`,
									) as string;
									if (spaced !== "ok") throw new Error(`Smoke: mail template editor ${spaced}`);
									await shootBoth("mail-template-spacing");
									// The same panel scrolled to Spacing and Appearance, which the
									// first shot cuts off.
									// Only the panel's own scroller moves: scrollIntoView would also
									// scroll every clipped ancestor and photograph a shifted window.
									const lowered = await window.webContents.executeJavaScript(
										`(() => {
											const heading = [...document.querySelectorAll("h3")].find((el) => el.textContent.trim() === "Spacing");
											if (!heading) return "no Spacing section";
											let scroller = heading.parentElement;
											while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
											if (!scroller) return "the design panel does not scroll";
											scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
											// Nothing inside the editor may make the window's main area
											// taller than it is: a clipped overflow there is what a focus
											// or a scroll into view shifts the whole window by.
											const main = document.querySelector("main");
											if (main.scrollHeight > main.clientHeight + 1) return "the main area overflows by " + (main.scrollHeight - main.clientHeight) + "px";
											return "ok";
										})()`,
									) as string;
									if (lowered !== "ok") throw new Error(`Smoke: mail template editor ${lowered}`);
									await new Promise((r) => setTimeout(r, 300));
									await shootBoth("mail-template-spacing-lower");

									// Actions (TODO 4b): the section after Effects, with an on-click link
									// and a hover fill added from the real panel on a text, checked in the
									// message that is sent, and the Button in the Text menu.
									const actioned = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const press = async (key, code, mods = {}, target = document.body) => {
												target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }));
												await wait(300);
											};
											const rows = (kind) => [...document.querySelectorAll('[data-layer-kind="' + kind + '"]')];
											const panel = (title) => {
												const heading = [...document.querySelectorAll("h3")].find((el) => el.textContent.trim() === title);
												return heading ? heading.closest("section") : null;
											};
											const compiled = async (has) => {
												document.querySelector('button[title="The message as it will be sent"]').click();
												let html = "";
												for (let tries = 0; tries < 40; tries++) {
													await wait(150);
													const frame = document.querySelector('iframe[title="Template preview"]');
													html = frame ? frame.getAttribute("srcdoc") || "" : "";
													if (has(html)) break;
												}
												document.querySelector('button[title="The canvas"]').click();
												await wait(300);
												return html;
											};
											const setText = async (labelText, value) => {
												const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === labelText);
												const field = label ? document.getElementById(label.htmlFor) : null;
												if (!field) return false;
												Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
												field.dispatchEvent(new Event("input", { bubbles: true }));
												await wait(300);
												return true;
											};
											const addAction = async (label) => {
												const add = panel("Actions").querySelector('button[aria-label="Add action"]');
												if (!add) return "no way to add an action";
												add.click();
												await wait(200);
												const item = [...panel("Actions").querySelectorAll("[role=menuitem]")].find((el) => el.textContent.trim() === label);
												if (!item) return "the Add action menu does not offer " + label;
												item.click();
												await wait(300);
												return "ok";
											};

											// A text block to work on.
											let found = false;
											for (const candidate of rows("block")) {
												candidate.click();
												await wait(250);
												if ([...document.querySelectorAll("label")].some((el) => el.textContent.trim() === "Text element")) {
													found = true;
													break;
												}
											}
											if (!found) return "no text block to give an action";

											// After Effects, before anything of the kind's own.
											const titles = [...document.querySelectorAll("h3")].map((el) => el.textContent.trim());
											if (titles.indexOf("Actions") < 0 || titles.indexOf("Actions") < titles.indexOf("Effects")) return "Actions does not follow Effects: " + titles.join(", ");
											if (panel("Actions").querySelector("[role=menu]")) return "the Add menu is open before it was asked for";

											// On click: an address typed into the row is a link in the message.
											let step = await addAction("On click");
											if (step !== "ok") return step;
											const again = panel("Actions").querySelector('button[aria-label="Add action"]');
											again.click();
											await wait(200);
											if ([...panel("Actions").querySelectorAll("[role=menuitem]")].some((el) => el.textContent.trim() === "On click")) return "a second on-click action is still offered";
											again.click();
											await wait(200);
											if (!(await setText("Link address", "example.be/aanbod"))) return "the click row has no address field";
											if (!panel("Actions").textContent.includes("Outlook on Windows makes only the text inside a link clickable")) return "a linked block does not say what Outlook on Windows does";
											if (!document.querySelector("[data-layer-linked]")) return "a linked layer has no link glyph";

											// On hover: a fill.
											step = await addAction("On hover: fill");
											if (step !== "ok") return step;
											if (!panel("Actions").textContent.includes("Works in Apple Mail")) return "a hover row does not say where it works";
											if (!panel("Actions").textContent.includes("Not in Gmail or Outlook on Windows")) return "a hover row does not say where it does not work";

											const html = await compiled((h) => h.includes("https://example.be/aanbod") && h.includes(":hover"));
											const wrapped = /<a href="https:\\/\\/example.be\\/aanbod" data-juno-link="1" style="display:block;text-decoration:none;color:inherit[^"]*"><p[^>]*data-juno-id="([^"]+)"/.exec(html);
											if (!wrapped) return "the sent message has no link round the text: " + html.slice(0, 600);
											const id = wrapped[1];
											if (!html.includes('class="jb-' + id + '"')) return "the text has no class for its hover rule";
											if (!new RegExp("\\\\.jb-" + id + ":hover\\\\{background-color:#[0-9a-f]{6} !important;background-image:none !important\\\\}").test(html)) return "the head has no hover rule for the text";

											// The scripts stay out: the section offers a link and a hover, nothing else.
											const offered = [];
											panel("Actions").querySelector('button[aria-label="Add action"]').click();
											await wait(200);
											for (const item of panel("Actions").querySelectorAll("[role=menuitem]")) offered.push(item.textContent.trim());
											panel("Actions").querySelector('button[aria-label="Add action"]').click();
											await wait(200);
											if (offered.join("|") !== "On hover: text colour|On hover: underline|On hover: opacity") return "the Add action menu offers " + offered.join("|");
											if (/script|focus|scroll|timer/i.test(panel("Actions").textContent)) return "the Actions section mentions a trigger a message cannot have";

											// The Button is in the Text menu, and adds a linked, filled text.
											if (document.querySelector('button[aria-label="Add button"]')) return "the toolbar still has a Button tool";
											const countBefore = rows("block").length;
											await press("b", "KeyB");
											if (rows("block").length !== countBefore) return "B on its own still adds something";
											await press("T", "KeyT", { shiftKey: true });
											if (!document.querySelector('[role=menu][aria-label="Text menu"]')) return "Shift+T did not open the Text menu";
											await press("B", "KeyB", { shiftKey: true }, document.activeElement);
											if (rows("block").length !== countBefore + 1) return "B in the Text menu did not add the Button";
											const typing = document.querySelector('[role=textbox][aria-label="Text"]');
											if (!typing) return "the new Button did not open for typing";
											typing.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await wait(300);
											const clickRow = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === "Link address");
											if (!clickRow) return "the Button has no empty on-click link row";
											if (!panel("Actions").textContent.includes("Empty, so it is sent without a link")) return "an empty link does not say it is sent without one";
											if (!(await setText("Link address", "example.be/boek"))) return "no address field on the Button";
											const buttonHtml = await compiled((h) => h.includes("example.be/boek"));
											if (!/<a href="https:\\/\\/example.be\\/boek" data-juno-link="1"[^>]*><p[^>]*style="[^"]*background-color:#4a3fa0[^"]*border-radius:4px/.test(buttonHtml)) return "the Button is not a filled, rounded text inside its link: " + buttonHtml.slice(0, 800);
											return "ok";
										})()`,
									) as string;
									if (actioned !== "ok") throw new Error(`Smoke: mail template editor ${actioned}`);

									// Back on the linked text, with the section scrolled into view for the photograph.
									const shown = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const link = document.querySelector("[data-layer-linked]");
											const row = link ? link.closest("button") : null;
											if (!row) return "no linked layer to select";
											row.click();
											await wait(300);
											const heading = [...document.querySelectorAll("h3")].find((el) => el.textContent.trim() === "Actions");
											if (!heading) return "no Actions section on the linked text";
											let scroller = heading.parentElement;
											while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
											if (!scroller) return "the design panel does not scroll";
											scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
											await wait(300);
											return "ok";
										})()`,
									) as string;
									if (shown !== "ok") throw new Error(`Smoke: mail template editor ${shown}`);
									await shootBoth("mail-template-actions");

									// Escape lets go of what is selected before it leaves, so the
									// first one drops the block that was just inserted and the second
									// one walks out. Nothing is saved on the way: the template in the
									// database is still the hand-written one it was.
									for (let press = 0; press < 2; press++) {
										await window.webContents.executeJavaScript(
											`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
										);
										await new Promise((r) => setTimeout(r, 400));
										if (press === 0) {
											// Nothing selected is the frame: its size, its fill and the
											// fonts the message links.
											const framePanel = await window.webContents.executeJavaScript(
												`[...document.querySelectorAll("h3")].some((el) => el.textContent.trim() === "Fonts")`,
											);
											if (!framePanel)
												throw new Error(
													"Smoke: mail template editor has no Fonts on the frame panel",
												);
											const frameImage = await capture(window.webContents);
											writeFileSync(
												joinPath(shotDir, `mail-template-frame.png`),
												frameImage.toPNG(),
											);
										}
									}

									// No Fill step either: the hand-written template asks for nothing
									// beyond a client and a project, so one Next reaches Review.
									const usedMail = (await window.webContents.executeJavaScript(
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
									)) as string;
									if (usedMail !== "ok") throw new Error(`Smoke: using a mail template ${usedMail}`);

									const useMailImage = await capture(window.webContents);
									writeFileSync(joinPath(shotDir, `use-mail-template.png`), useMailImage.toPNG());

									// Nothing was created yet at this point, so Escape is enough: it
									// exits the sequence rather than stepping back through it.
									await window.webContents.executeJavaScript(
										`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 500));

									// A new template, the way a person makes one: the plus opens into
									// a name, Enter creates it, and the editor opens on a canvas. This
									// used to refuse outright, because it created with no subject and
									// the service requires one.
									const opened = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											// The template read earlier is still open beside the list.
											const close = document.querySelector('button[aria-label="Close"]');
											if (close) {
												close.click();
												await wait(400);
											}
											const plus = document.querySelector('button[aria-label="New mail template"]');
											if (!plus) return "no plus on the list";
											plus.click();
											await wait(400);
											const field = document.querySelector('input[aria-label="New mail template"]');
											if (!field) return "the plus did not open into a name field";
											if (document.activeElement !== field) return "the name field did not take the focus";
											const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
											setValue.call(field, "Smoke nieuwsbrief");
											field.dispatchEvent(new Event("input", { bubbles: true }));
											await wait(200);
											return "ok";
										})()`,
									)) as string;
									if (opened !== "ok") throw new Error(`Smoke: creating a mail template ${opened}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-add.png`),
										(await capture(window.webContents)).toPNG(),
									);

									const created = (await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const field = document.querySelector('input[aria-label="New mail template"]');
											field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
											let panel = null;
											for (let tries = 0; tries < 20 && !panel; tries++) {
												await wait(150);
												panel = document.querySelector('button[aria-label="Hide the panel"]');
											}
											if (!panel) {
												const alert = document.querySelector("[role=alert]");
												return "no editor opened" + (alert ? ": " + alert.textContent.trim() : "");
											}
											const valueOf = (text) => {
												const label = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === text);
												const input = label ? document.getElementById(label.htmlFor) : null;
												return input ? input.value : null;
											};
											if (valueOf("Template name") !== "Smoke nieuwsbrief") return "the editor does not carry the name";
											if (valueOf("Subject") !== "Smoke nieuwsbrief") return "the subject did not start as the name";
											if (!document.querySelector('button[aria-label="Drag to change the height of the sheet"]')) return "a new template did not open on a canvas";
											return "ok";
										})()`,
									)) as string;
									if (created !== "ok") throw new Error(`Smoke: creating a mail template ${created}`);
									writeFileSync(
										joinPath(shotDir, `mail-template-new.png`),
										(await capture(window.webContents)).toPNG(),
									);

									// Nothing is selected on a new canvas, so one Escape leaves, and the
									// template is on the list because creating it saved it.
									const listed = (await window.webContents.executeJavaScript(
										`(async () => {
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 600));
											const rows = [...document.querySelectorAll("main li")].map((el) => el.textContent);
											return rows.some((text) => text.includes("Smoke nieuwsbrief")) ? "ok" : "the new template is not on the list";
										})()`,
									)) as string;
									if (listed !== "ok") throw new Error(`Smoke: creating a mail template ${listed}`);

									// The example a first install is given. This database is
									// fresh, so it is here and none of the four retired templates are,
									// and against the demo client it fills in with nothing missing.
									// Every picture in it is at a web address, which this window refuses
									// to load, so the steps below also prove that neither the canvas
									// nor a preview tries: a refused load fails the run.
									const exampleFacts = await window.webContents.executeJavaScript(
										`(async () => {
											const b = window.juno;
											const all = await b.mail.templates.listAll();
											const example = all.find((t) => t.key === "voorbeeld");
											if (!example) return "a fresh install has no example";
											if (all.some((t) => ["contract_cover", "project_kickoff", "invoice_due", "hosting_renewal"].includes(t.key))) return "a fresh install was given a retired template";
											if (!example.layout) return "the example has no canvas";
											if (example.isSystem) return "the example is a system row";
											const clients = await b.clients.list({ limit: 50 });
											const obet = clients.find((c) => c.name === "obet");
											if (!obet) return "no demo client";
											const extras = Object.fromEntries(example.inputs.map((input) => [input.key, input.defaultValue || ""]));
											const filled = await b.mail.templates.preview({ subject: example.subject, layout: example.layout, inputs: example.inputs, clientId: obet.id, extras });
											if (filled.missing.length > 0) return "the example has no value for " + filled.missing.join(", ");
											if (!filled.bodyHtml.includes("Beste Laura,")) return "the example does not greet the demo client";
											if (!filled.bodyHtml.includes("Kerkstraat 1, 9000 Gent")) return "the example does not carry the business address";
											return "ok:" + example.updatedAt;
										})()`,
									) as string;
									if (!exampleFacts.startsWith("ok:")) throw new Error(`Smoke: the example ${exampleFacts}`);
									const exampleUpdatedAt = exampleFacts.slice(3);

									// Used the way a person would: the picture it asks for, a client,
									// and the review. The review is the example filled in against the
									// demo client, and it must say nothing is missing.
									const exampleReview = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const row = [...document.querySelectorAll("main ul li button")].find((el) => el.textContent.includes("Voorbeeld"));
											if (!row) return "no row for the example";
											row.click();
											await wait(900);
											const panel = document.querySelector("main");
											if (!panel || !panel.querySelector("iframe")) return "the example opens no preview";
											if (!panel.querySelector("iframe").getAttribute("srcdoc").includes("data-juno-remote-image")) return "the preview does not stand a box in for a picture at a web address";
											const use = [...panel.querySelectorAll("button")].find((el) => el.textContent.trim() === "Use");
											if (!use) return "no use action";
											use.click();
											await wait(700);
											const ask = [...document.querySelectorAll("main label")].find((el) => el.textContent.trim().startsWith("Foto"));
											const field = ask ? document.getElementById(ask.htmlFor) : null;
											if (!field) return "the Fill step does not ask for the picture";
											if (!field.value.startsWith("https://")) return "the picture starts without an address";
											const next = () => [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Next");
											next().click();
											await wait(500);
											const clientLabel = [...document.querySelectorAll("label")].find((el) => el.textContent.trim() === "Client");
											const select = clientLabel ? document.getElementById(clientLabel.htmlFor) : null;
											if (!select) return "no client to pick";
											const obet = [...select.options].find((option) => option.textContent.trim() === "obet");
											if (!obet) return "the demo client is not offered";
											Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, obet.value);
											select.dispatchEvent(new Event("change", { bubbles: true }));
											await wait(500);
											next().click();
											let frame = null;
											for (let tries = 0; tries < 30 && !frame; tries++) {
												await wait(200);
												frame = document.querySelector('main iframe[title="Message preview"]');
											}
											if (!frame) return "the review shows no message";
											await wait(600);
											const main = document.querySelector("main");
											const gap = main.textContent.indexOf("No value for");
											if (gap >= 0) return "the review says a value is missing: " + main.textContent.slice(gap, gap + 120);
											if (!main.textContent.includes("Voorbeeld: bericht voor obet")) return "the subject did not fill in for the demo client";
											const html = frame.getAttribute("srcdoc") || "";
											if (!html.includes("Beste Laura,")) return "the review does not greet the demo client";
											if (/<img[^>]+src="https:/.test(html)) return "the review still asks for a picture at a web address";
											return "ok";
										})()`,
									) as string;
									if (exampleReview !== "ok") throw new Error(`Smoke: using the example ${exampleReview}`);
									await shootBoth("mail-template-example-review");
									await window.webContents.executeJavaScript(
										`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 500));

									// Opened in the editor: the layers name its parts, the picture at a
									// web address is a box that says who loads it, and what it asks for
									// is in the Asks view.
									const exampleOpen = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const row = [...document.querySelectorAll("main ul li button")].find((el) => el.textContent.includes("Voorbeeld"));
											if (!row) return "no row for the example";
											row.click();
											await wait(900);
											const edit = [...document.querySelectorAll("main button")].find((el) => el.textContent.trim() === "Edit");
											if (!edit) return "no edit action";
											edit.click();
											let ready = null;
											for (let tries = 0; tries < 30 && !ready; tries++) {
												await wait(150);
												ready = document.querySelector('button[aria-label="Hide the panel"]');
											}
											if (!ready) return "no editor panel";
											await wait(1500);
											const layers = [...document.querySelectorAll("[data-layer-kind]")].map((el) => el.textContent.trim());
											for (const name of ["Kop", "Inhoud", "Twee kolommen", "Vergelijking", "Scheidingslijn", "Voettekst"]) {
												if (!layers.some((text) => text.startsWith(name))) return "no layer named " + name;
											}
											if (!document.body.textContent.includes("not by Juno.")) return "the canvas does not say who loads the logo";
											if (document.querySelector('img[src^="http"]')) return "the canvas is drawing a picture at a web address";
											return "ok";
										})()`,
									) as string;
									if (exampleOpen !== "ok") throw new Error(`Smoke: the example in the editor ${exampleOpen}`);
									// Nothing is selected on opening, so the frame's panel is showing.
									await shootBoth("mail-template-example");

									// The other half of it: the table, the button, the code and the footer.
									const exampleLower = await window.webContents.executeJavaScript(
										`(async () => {
											const footer = document.querySelector('[data-canvas-id="voorbeeld-voet"]');
											if (!footer) return "the footer is not on the canvas";
											footer.scrollIntoView({ block: "end" });
											await new Promise((r) => setTimeout(r, 400));
											return "ok";
										})()`,
									) as string;
									if (exampleLower !== "ok") throw new Error(`Smoke: the example in the editor ${exampleLower}`);
									await shootBoth("mail-template-example-lower");

									const exampleViews = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const asks = document.querySelector('button[title="What this template asks for"]');
											if (!asks) return "no asks view";
											asks.click();
											await wait(500);
											if (![...document.querySelectorAll("input")].some((el) => el.value === "foto")) return "the Asks view does not list the picture";
											return "ok";
										})()`,
									) as string;
									if (exampleViews !== "ok") throw new Error(`Smoke: the example in the editor ${exampleViews}`);
									writeFileSync(joinPath(shotDir, `mail-template-example-asks.png`), (await capture(window.webContents)).toPNG());

									const exampleSent = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const view = document.querySelector('button[title="The message as it will be sent"]');
											if (!view) return "no preview view";
											view.click();
											let frame = null;
											for (let tries = 0; tries < 30 && !frame; tries++) {
												await wait(150);
												frame = document.querySelector('iframe[title="Template preview"]');
											}
											if (!frame) return "the message did not render";
											const html = frame.getAttribute("srcdoc") || "";
											if (!html.includes("data-juno-remote-image")) return "the preview does not stand a box in for the logo";
											if (/<img[^>]+src="https:/.test(html)) return "the preview still asks for a picture at a web address";
											if (html.includes("[ontbreekt: document.foto]")) return "the preview does not use the picture the template offers";
											if (!html.includes("@media only screen and (max-width:480px)")) return "the phone breakpoint is not in the message";
											return "ok";
										})()`,
									) as string;
									if (exampleSent !== "ok") throw new Error(`Smoke: the example in the editor ${exampleSent}`);
									await shootBoth("mail-template-example-view");

									const examplePhone = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const phone = [...document.querySelectorAll('[role=group][aria-label="Preview width"] button')].find((el) => el.textContent.trim().startsWith("Phone"));
											if (!phone) return "the preview has no Phone width";
											phone.click();
											await wait(600);
											return phone.getAttribute("aria-pressed") === "true" ? "ok" : "the Phone width did not take";
										})()`,
									) as string;
									if (examplePhone !== "ok") throw new Error(`Smoke: the example in the editor ${examplePhone}`);
									await shootBoth("mail-template-example-phone");

									// Looking at it changes nothing: leaving writes no save.
									const exampleLeft = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											for (let press = 0; press < 3 && document.querySelector('button[aria-label="Hide the panel"]'); press++) {
												document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
												await wait(500);
											}
											if (document.querySelector('button[aria-label="Hide the panel"]')) return "Escape did not leave the editor";
											const example = (await window.juno.mail.templates.listAll()).find((t) => t.key === "voorbeeld");
											return example ? example.updatedAt : "the example went away";
										})()`,
									) as string;
									if (exampleLeft !== exampleUpdatedAt) throw new Error(`Smoke: opening the example wrote to it (${exampleLeft})`);
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

											// A click outside the panel closes it, the same way Escape
											// does. Escape is the other path this walk checks below.
											document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
											await new Promise((r) => setTimeout(r, 200));
											if (document.querySelector("aside[aria-label]")) return "a click outside did not close the side panel";

											chip.click();
											await new Promise((r) => setTimeout(r, 400));
											const reopened = document.querySelector("aside[aria-label]");
											if (!reopened) return "the side panel did not reopen";
											const edit = [...reopened.querySelectorAll("button")].find((el) => el.textContent.trim() === "Edit");
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
								if (screen === "Calendar") {
									// A reminder on the grid is not read-only: its panel offers the
									// same actions as the Reminders screen, and deleting it can be
									// undone from the toast.
									const acted = await window.webContents.executeJavaScript(
										`(async () => {
											const wait = (ms) => new Promise((r) => setTimeout(r, ms));
											const chip = () => [...document.querySelectorAll("button[title]")].find((b) => b.getAttribute("title") === "Send hyge the proposal");
											const named = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
											if (!chip()) return "no reminder chip";
											chip().click();
											await wait(500);
											for (const need of ["Mark done", "Snooze", "Edit", "Delete"]) {
												if (!named(need)) return "the reminder panel has no " + need;
											}
											named("Delete").click();
											await wait(700);
											if (chip()) return "the reminder is still on the grid after delete";
											if (!document.body.textContent.includes("Send hyge the proposal deleted.")) return "no undo toast";
											named("Undo").click();
											await wait(700);
											return chip() ? "ok" : "undo did not bring the reminder back";
										})()`,
									);
									if (acted !== "ok") throw new Error(`Smoke: calendar reminder actions ${acted}`);
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
									// A draft with a picture at a web address opens in the composer,
									// which parks it so the window fetches nothing, and saving from
									// the composer puts the address back.
									const pictured = await window.webContents.executeJavaScript(
										`(async () => {
											const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Drafts"));
											if (!nav) return "no drafts entry";
											nav.click();
											await new Promise((r) => setTimeout(r, 600));
											// One list, both kinds of row: Juno's own unsent messages and the
											// threads in the server's Drafts folder.
											const kinds = new Set([...document.querySelectorAll("li[data-draft-kind]")].map((el) => el.getAttribute("data-draft-kind")));
											if (!kinds.has("outbox")) return "no unsent message in the list";
											if (!kinds.has("thread")) return "no server draft in the list";
											const row = [...document.querySelectorAll("ul li button")].find((el) => el.textContent.includes("Met logo"));
											if (!row) return "no draft with a picture";
											row.click();
											await new Promise((r) => setTimeout(r, 600));
											await new Promise((r) => setTimeout(r, 900));
											const host = document.querySelector("[contenteditable][aria-label=Message]");
											if (!host) return "no editor";
											if (host.querySelector("img[src]") || !host.querySelector("img[data-juno-src]")) return "the editor loads the picture: " + host.innerHTML.slice(0, 200);
											host.append(document.createTextNode(" Tot dan."));
											host.dispatchEvent(new Event("input", { bubbles: true }));
											await new Promise((r) => setTimeout(r, 1500));
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 900));
											return "ok";
										})()`,
									);
									if (pictured !== "ok") throw new Error(`Smoke: drafts picture ${pictured}`);
									const saved = (await (await import("./main/services/mail-outbox")).list({ states: ["draft"] })).find((m) => m.subject === "Met logo");
									if (!saved?.bodyHtml?.includes('src="https://www.example.com/logo.png"') || saved.bodyHtml.includes("data-juno-src") || !saved.bodyText.includes("Tot dan.")) {
										throw new Error(`Smoke: the composer did not save the picture's address: ${saved?.bodyHtml}`);
									}
									console.log("SMOKE_DEMO draft picture parked and restored");
									// A draft an agent writes opens in the editor, the way one a person
									// started would. There is no banner to approve and no send for it.
									await (await import("./main/services/mail-outbox")).createDraft({
										accountId: saved.accountId,
										to: [{ name: null, address: "kris@example.test" }],
										subject: "Written by the agent",
										bodyText: "Hello Kris.",
										actor: "agent",
									});
									const agentEditor = await window.webContents.executeJavaScript(
										`(async () => {
											await new Promise((r) => setTimeout(r, 1200));
											const host = document.querySelector("[contenteditable][aria-label=Message]");
											const subject = [...document.querySelectorAll("input")].some((el) => el.value === "Written by the agent");
											if (!host || !subject) return "the agent's draft did not open in the editor";
											if (document.body.textContent.includes("An assistant prepared")) return "the old approval banner is back";
											document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
											await new Promise((r) => setTimeout(r, 900));
											return "ok";
										})()`,
									);
									if (agentEditor !== "ok") throw new Error(`Smoke: agent draft ${agentEditor}`);
									console.log("SMOKE_DEMO agent draft opened in the editor");
									// The merged list itself, in both themes, before a row takes the pane.
									await window.webContents.executeJavaScript(
										`(async () => {
											const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Drafts"));
											if (nav) nav.click();
											await new Promise((r) => setTimeout(r, 600));
										})()`,
									);
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await window.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 300));
										const shot = await capture(window.webContents);
										writeFileSync(joinPath(shotDir, `drafts-list-${theme}.png`), shot.toPNG());
									}
									// A server draft opens as a thread, like any other folder's.
									const server = await window.webContents.executeJavaScript(
										`(async () => {
											const nav = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Drafts"));
											if (!nav) return "no drafts entry";
											nav.click();
											await new Promise((r) => setTimeout(r, 600));
											const row = document.querySelector("li[data-draft-kind=thread] button");
											if (!row) return "no server draft row";
											row.click();
											await new Promise((r) => setTimeout(r, 800));
											if (document.querySelector("li[data-draft-kind]")) return "the list stayed over the thread";
											const text = document.body.textContent;
											if (!text.includes("Offerte website") && !text.includes("Nieuw dit najaar")) return "the thread did not open";
											return "ok";
										})()`,
									);
									if (server !== "ok") throw new Error(`Smoke: server draft ${server}`);
									console.log("SMOKE_DEMO drafts list both kinds, server draft opens as a thread");
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

									// A reply sent from Juno, with the Sent folder not synced yet. The
									// reader has to list it from the outbox in the thread opened below.
									const { getThread: getSmokeThread, listThreads: listSmokeThreads } = await import("./main/services/mail-threads");
									const smokeOutbox = await import("./main/services/mail-outbox");
									const [newestThread] = await listSmokeThreads({ limit: 1 });
									const answered = newestThread ? (await getSmokeThread(newestThread.id))?.messages.at(-1) : undefined;
									if (!newestThread || !answered) throw new Error("Smoke: no thread to answer");
									const smokeReply = await smokeOutbox.createDraft({
										accountId: answered.accountId,
										to: [answered.from ?? { name: null, address: "laura@obet.be" }],
										subject: `Re: ${newestThread.subject}`,
										bodyText: "Smoke reply, sent before the Sent folder is synced.",
										replyToMessageId: answered.id,
									});
									await smokeOutbox.requestSend(smokeReply.id);
									await mailSend.processQueue();
									if ((await smokeOutbox.get(smokeReply.id))?.state !== "sent") throw new Error("Smoke: the reply did not send");

									// Opens the newest thread, so the reader and its frame are in
									// the picture, and checks the frame actually loaded a body.
									const mailResponses: { url: string; statusCode: number }[] = [];
									window.webContents.session.webRequest.onCompleted(
										{ urls: ["app://mail/*"] },
										(details) => {
											mailResponses.push({ url: details.url, statusCode: details.statusCode });
										},
									);
									const opened = await window.webContents.executeJavaScript(
										`(async () => {
											const row = document.querySelector("ul li button");
											if (!row) return "no rows";
											row.click();
											await new Promise((r) => setTimeout(r, 1200));
											// A sender nobody has trusted and no client link shows a question
											// instead of the body. Trusting this one message is what a person
											// reading it would do, and it leaves the sender untrusted.
											const trust = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Trust this email");
											if (trust) {
												trust.click();
												await new Promise((r) => setTimeout(r, 1200));
											}
											return document.querySelector('iframe[src^="app://mail/message/"]') ? "ok" : "no frame";
										})()`,
									);
									if (opened !== "ok") throw new Error(`Smoke: mail reader ${opened}`);
									// The reader shows one message at a time and lists the whole
									// conversation beside it, so the sent reply is a row of that list first.
									const outgoingShown = await window.webContents.executeJavaScript(
										`(async () => {
											const rows = [...document.querySelectorAll('aside[aria-label="Conversation"] ol button')];
											const sent = rows.filter((el) => el.textContent.trim().startsWith("You"));
											if (sent.length !== 1) return "the sent reply is not listed in its thread";
											sent[0].click();
											await new Promise((r) => setTimeout(r, 400));
											if (document.querySelectorAll("article[data-outgoing]").length !== 1) return "the sent reply did not open";
											return "ok";
										})()`,
									);
									if (outgoingShown !== "ok") throw new Error(`Smoke: mail reader ${outgoingShown}`);
									await shoot("mail-outgoing");
									// Back to the received message, which is what the frame checks below read.
									await window.webContents.executeJavaScript(
										`(async () => {
											const rows = [...document.querySelectorAll('aside[aria-label="Conversation"] ol button')];
											rows.find((el) => !el.textContent.trim().startsWith("You"))?.click();
											await new Promise((r) => setTimeout(r, 1200));
										})()`,
									);
									await window.webContents.executeJavaScript(`document.querySelector("article")?.closest(".overflow-y-auto")?.scrollTo(0, 0)`);
									// A frame the CSP refused would sit on about:blank. One that
									// navigated to the mail origin proves the scheme host answered
									// and the frame-src rule let it through.
									const mailFrame = window.webContents.mainFrame.framesInSubtree.find((f) =>
										f.url.startsWith("app://mail/message/"),
									);
									if (!mailFrame)
										throw new Error("Smoke: the message frame did not load from app://mail");
									// The frame remains opaque to the app. The request log says whether
									// the scheme host answered it with a body.
									const served = mailResponses.find((r) => r.url === mailFrame.url);
									if (!served || served.statusCode !== 200) {
										throw new Error(
											`Smoke: the message frame got ${served?.statusCode ?? "no response"}`,
										);
									}
									console.log(`SMOKE_DEMO mail frame=${mailFrame.url}`);
									await new Promise((r) => setTimeout(r, 400));

									const measured = await window.webContents.executeJavaScript(
										`(async () => {
											const frame = document.querySelector('iframe[title^="Message from"]');
											if (!frame) return "no frame";
											return frame.style.height ? "ok" : "no measured height";
										})()`,
									);
									if (measured !== "ok") throw new Error(`Smoke: mail reader height ${measured}`);
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

								// An account that was set up, synced and then removed, so Mail accounts
								// has a removed account with mail on disk to photograph and purge.
								const oldAccountId = (await window.webContents.executeJavaScript(`(async () => {
									const b = window.juno;
									const old = await b.mail.accounts.create({ email: "oud@juno.test", label: "Oud", imapHost: "imap.juno.test", password: "smoke" });
									const runs = await b.mail.sync.run(old.id);
									if (runs.some((r) => r.phase !== "done")) throw new Error("Smoke: the second account did not sync: " + JSON.stringify(runs));
									await b.mail.accounts.remove(old.id);
									return old.id;
								})()`)) as string;

								openSettingsWindow();
								const settingsWindow = getSettingsWindow();
								if (!settingsWindow) throw new Error("Smoke: the settings window did not open");
								// Its own renderer, so its errors are not the main window's and have
								// to be listened for separately or a crash there is only a blank page.
								settingsWindow.webContents.on("console-message", (event) => {
									if (event.level === "warning" || event.level === "error") {
										console.error(`renderer: ${event.message}`);
									}
								});

								await new Promise<void>((resolve) => {
									if (!settingsWindow.webContents.isLoading()) {
										setTimeout(resolve, 900);
										return;
									}
									settingsWindow.webContents.once("did-finish-load", () => setTimeout(resolve, 900));
								});

								const inSettings = (code: string) => settingsWindow.webContents.executeJavaScript(code);
								const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
								/** Both themes, the way every other screen is photographed. */
								const photograph = async (name: string, wait = 350) => {
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await inSettings(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
										await pause(wait);
										const image = await capture(settingsWindow.webContents);
										writeFileSync(joinPath(shotDir, `settings-${name}-${theme}.png`), image.toPNG());
									}
								};
								/**
								 * A page is opened the way a person opens it: its group first, which unfolds
								 * the pages of that group, then the page.
								 */
								const openPage = async (id: string, group?: string) => {
									if (group) await inSettings(`document.querySelector("[data-group='${group}']").click()`);
									await pause(150);
									const found = await inSettings(`(() => { const b = document.querySelector("[data-page='${id}']"); if (!b) return false; b.click(); return true; })()`);
									if (!found) throw new Error(`Smoke: the settings window has no page "${id}"`);
									await pause(300);
								};

								const groups = (await inSettings(
									`[...document.querySelectorAll("nav[aria-label='Settings sections'] [data-group]")].map((b) => b.dataset.group)`,
								)) as string[];
								if (groups.length !== 6) {
									throw new Error(`Smoke: the settings window showed ${groups.length} groups`);
								}

								// Every page of every group, in both themes. A group is clicked and then the
								// pages it unfolded are read from the navigation, so the list is whatever the
								// window actually offers rather than a copy of it here.
								const pages: string[] = [];
								for (const group of groups) {
									await inSettings(`document.querySelector("[data-group='${group}']").click()`);
									await pause(200);
									const ids = (await inSettings(
										`(() => { const own = document.querySelector("[data-group='${group}']").dataset.page; return own ? [own] : [...document.querySelectorAll("nav[aria-label='Settings sections'] ul [data-page]")].map((b) => b.dataset.page); })()`,
									)) as string[];
									for (const id of ids) {
										await openPage(id);
										pages.push(id);
										await photograph(id);
									}
								}
								if (pages.length < 14) throw new Error(`Smoke: the settings window offered ${pages.length} pages`);


								// The two contact lists are where the primary and the mail-account mark are.
								{
									await openPage("contact", "business");
									const listed = (await inSettings(
										`(() => { const text = document.querySelector("main").textContent; return text.includes("Email addresses") && text.includes("Phone numbers") && text.includes("Mail account"); })()`,
									)) as boolean;
									if (!listed) throw new Error("Smoke: the contact page did not list the owner's addresses");
								}

								// The update settings are on their own page now, not under the fold.
								{
									await openPage("updates", "general");
									const shown = (await inSettings(
										`document.querySelector("main").textContent.includes("Install updates automatically")`,
									)) as boolean;
									if (!shown) throw new Error("Smoke: the updates page did not show the update settings");
								}

								// Statuses and labels shows one list at a time, and switching is a tab.
								{
									await openPage("statuses", "documents");
									const picked = (await inSettings(
										`(async () => {
											const tabs = [...document.querySelectorAll("[role=tablist][aria-label='Which list'] [role=tab]")];
											if (tabs.length < 4) return "only " + tabs.length + " lists";
											const before = document.querySelector("main").textContent;
											tabs[1].click();
											await new Promise((r) => setTimeout(r, 250));
											if (document.querySelector("main").textContent === before) return "the list did not change";
											if (tabs[1].getAttribute("aria-selected") !== "true") return "the tab did not select";
											return "ok";
										})()`,
									)) as string;
									if (picked !== "ok") throw new Error(`Smoke: statuses and labels ${picked}`);
									await photograph("statuses-project");
								}

								// The MCP connect page hides half of itself behind a two-way switch, so the
								// loop above only ever photographs the installers. The other side is the
								// block someone pastes by hand, and it has broken before.
								{
									await openPage("mcp-connect", "mcp");
									const switched = (await inSettings(
										`(() => {
											const b = [...document.querySelectorAll("button[role=radio]")]
												.find((el) => el.textContent.trim() === "Do it myself");
											if (!b) return false;
											b.click();
											return true;
										})()`,
									)) as boolean;
									if (!switched) throw new Error("Smoke: the MCP page had no way to the manual route");
									await pause(350);
									const pasted = (await inSettings(
										`(document.querySelector("pre")?.textContent ?? "").includes("http://127.0.0.1:")`,
									)) as boolean;
									if (!pasted) throw new Error("Smoke: the manual route printed no configuration");
									await photograph("mcp-manual", 300);
								}

								// The search lives above the groups and answers on a page of its own. It is
								// typed into the way a person types: focused, then characters, then keys.
								{
									const type = async (word: string) => {
										await inSettings(
											`(() => { const f = document.querySelector("input[aria-label='Search settings']"); f.focus(); f.select(); })()`,
										);
										settingsWindow.webContents.focus();
										await settingsWindow.webContents.insertText(word);
										await pause(350);
									};
									const read = (expr: string) => inSettings(expr);

									await type("lock");
									const first = (await read(
										`(() => ({ rows: document.querySelectorAll("[role=listbox] [role=option]").length, text: document.querySelector("main").textContent, selected: document.querySelector("[role=option][aria-selected=true]")?.textContent ?? "" }))()`,
									)) as { rows: number; text: string; selected: string };
									if (first.rows < 1 || !first.text.includes("match") || !first.selected.includes("Lock")) {
										throw new Error(`Smoke: searching for lock showed ${JSON.stringify(first)}`);
									}
									await photograph("search", 300);

									// Enter opens the chosen result: the page, with the lock section on it.
									settingsWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
									settingsWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
									await pause(500);
									const opened = (await read(
										`(() => ({ page: document.querySelector("[data-page][aria-current=page]")?.dataset.page ?? "", field: document.querySelector("input[aria-label='Search settings']").value, lock: document.querySelector("[data-setting='lock']") !== null }))()`,
									)) as { page: string; field: string; lock: boolean };
									if (opened.page !== "lock" || opened.field !== "" || !opened.lock) {
										throw new Error(`Smoke: Enter on a result opened ${JSON.stringify(opened)}`);
									}

									// A slip of the finger still lands, and nothing at all says so out loud.
									await type("lokc");
									const typo = (await read(
										`document.querySelector("[role=option][aria-selected=true]")?.textContent ?? ""`,
									)) as string;
									if (!typo.includes("Lock")) throw new Error(`Smoke: a typo did not find the lock: ${typo}`);

									await type("qqqqqq");
									const none = (await read(`document.querySelector("main").textContent`)) as string;
									if (!none.includes("Nothing matches")) throw new Error("Smoke: a search with no answer said nothing");
									await photograph("search-empty", 300);

									// Escape clears the search first, and only then would close the window.
									settingsWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
									settingsWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
									await pause(300);
									const cleared = (await read(
										`document.querySelector("input[aria-label='Search settings']").value === ""`,
									)) as boolean;
									if (!cleared) throw new Error("Smoke: Escape did not clear the search");
									if (settingsWindow.isDestroyed()) throw new Error("Smoke: Escape in the search closed the window");
								}

								// The removed account's mail is deleted the way a person does it: the
								// button, the dialog, the confirm. The tab loop above photographed the
								// section with the account still in it.
								{
									const { existsSync: exists } = await import("node:fs");
									await openPage("mail", "mail");
									await new Promise((r) => setTimeout(r, 400));
									const listed = (await settingsWindow.webContents.executeJavaScript(
										`(() => { const text = document.querySelector("main").textContent; return text.includes("Removed accounts") && text.includes("oud@juno.test") && text.includes("Delete stored mail"); })()`,
									)) as boolean;
									if (!listed) throw new Error("Smoke: the mail section did not list the removed account");
									if (!exists(join(mailDir(), oldAccountId))) throw new Error("Smoke: the removed account has no mail on disk to purge");
									const opened = (await settingsWindow.webContents.executeJavaScript(
										`(() => { const button = [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Delete stored mail"); if (!button) return false; button.click(); return true; })()`,
									)) as boolean;
									if (!opened) throw new Error("Smoke: there was no button to delete the stored mail");
									await new Promise((r) => setTimeout(r, 400));
									for (const theme of ["light", "dark"] as const) {
										nativeTheme.themeSource = theme;
										await settingsWindow.webContents.executeJavaScript(
											`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
										);
										await new Promise((r) => setTimeout(r, 350));
										const image = await capture(settingsWindow.webContents);
										writeFileSync(joinPath(shotDir, `settings-purge-dialog-${theme}.png`), image.toPNG());
									}
									const confirmed = (await settingsWindow.webContents.executeJavaScript(
										`(() => { const button = [...document.querySelectorAll("[role='dialog'] button")].find((b) => b.textContent.trim() === "Delete"); if (!button) return false; button.click(); return true; })()`,
									)) as boolean;
									if (!confirmed) throw new Error("Smoke: the purge dialog had no Delete button");
									await new Promise((r) => setTimeout(r, 800));
									const after = (await settingsWindow.webContents.executeJavaScript(
										`({ section: document.querySelector("main").textContent.includes("Removed accounts"), notice: document.body.textContent.includes("Stored mail deleted.") })`,
									)) as { section: boolean; notice: boolean };
									if (after.section || !after.notice) {
										throw new Error(`Smoke: after the purge the section showed=${after.section} and the notice showed=${after.notice}`);
									}
									const remaining = (await window.webContents.executeJavaScript(
										`window.juno.mail.accounts.removed().then((rows) => rows.length)`,
									)) as number;
									if (remaining !== 0 || exists(join(mailDir(), oldAccountId))) {
										throw new Error("Smoke: the purge left the removed account's mail behind");
									}
									console.log("SMOKE_DEMO removed account purged");
								}
								console.log(`SMOKE_DEMO settings pages=${pages.length}`);
								closeSettingsWindow();

								// The sidebar goes back to the rail on its own, and the setting
								// in the window just photographed turns that off. Only a docked
								// sidebar does either: a window narrow enough for the drawer has
								// nothing to prove here, and the screens loop covers the drawer.
								const docked = (await window.webContents.executeJavaScript(
									`Boolean(document.querySelector("nav[data-sidebar]")) && window.innerWidth >= 760`,
								)) as boolean;
								if (docked) {
									await new Promise((r) => setTimeout(r, 500));
									const sidebarState = () =>
										window.webContents.executeJavaScript(
											`document.querySelector("nav[data-sidebar]")?.getAttribute("data-collapsed") ?? "missing"`,
										) as Promise<string>;
									const expand = async () => {
										if ((await sidebarState()) === "true") {
											await window.webContents.executeJavaScript(
												`document.querySelector("[data-sidebar-toggle]").click()`,
											);
											await new Promise((r) => setTimeout(r, 300));
										}
										if ((await sidebarState()) !== "false")
											throw new Error("Smoke: the sidebar toggle did not open it");
									};
									const choose = async () => {
										await window.webContents.executeJavaScript(
											`document.querySelector("nav[data-sidebar] button[data-nav=clients]").click()`,
										);
										await new Promise((r) => setTimeout(r, 400));
									};

									await expand();
									await choose();
									if ((await sidebarState()) !== "true") {
										throw new Error("Smoke: choosing a screen did not collapse the sidebar");
									}
									await expand();
									await window.webContents.executeJavaScript(
										`document.querySelector("main").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`,
									);
									await new Promise((r) => setTimeout(r, 300));
									if ((await sidebarState()) !== "true") {
										throw new Error("Smoke: a click beside the sidebar did not collapse it");
									}

									// Off, in the settings window, the way a person turns it off.
									// Closing the window is what tells the main window.
									openSettingsWindow("general");
									const again = getSettingsWindow();
									if (!again)
										throw new Error("Smoke: the settings window did not open a second time");
									await new Promise<void>((resolve) => {
										if (!again.webContents.isLoading()) {
											setTimeout(resolve, 900);
											return;
										}
										again.webContents.once("did-finish-load", () => setTimeout(resolve, 900));
									});
									const unticked = (await again.webContents.executeJavaScript(
										`(async () => {
											const toggle = [...document.querySelectorAll("button[role=switch]")].find((el) => el.textContent.includes("Collapse the sidebar on its own"));
											if (!toggle) return "no switch";
											if (toggle.getAttribute("aria-checked") !== "true") return "the switch starts off";
											toggle.click();
											await new Promise((r) => setTimeout(r, 400));
											return toggle.getAttribute("aria-checked") === "false" ? "ok" : "the switch did not change";
										})()`,
									)) as string;
									if (unticked !== "ok") throw new Error(`Smoke: sidebar setting ${unticked}`);
									closeSettingsWindow();
									await new Promise((r) => setTimeout(r, 700));

									await expand();
									await choose();
									if ((await sidebarState()) !== "false") {
										throw new Error("Smoke: the sidebar collapsed with the setting turned off");
									}
									console.log("SMOKE_DEMO sidebar auto-collapse=ok");
								}
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

	app.on("before-quit", (event) => {
		// A downloaded update is installed here, with a window saying so. That
		// pass quits again and lands below on its second visit.
		if (installOnQuit(event)) return;
		notifications.stop();
		// A dev server left behind by a closed app is a port nobody can explain.
		projectRunner.stopAll();
		mailSync.stopScheduler();
		mailSend.stopScheduler();
		stopAgentSurface();
		closeDb();
	});
}
