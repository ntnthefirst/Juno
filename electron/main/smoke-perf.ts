/**
 * Timings for `npm run smoke` with JUNO_SMOKE_PERF set. Never loaded outside it.
 *
 * Seeds a business of a realistic size through the bridge, the way a person's
 * records arrive, then times what a person waits for: the first paint, each of
 * the seven places, opening a record, a long list, and a theme change in the
 * main window and in settings over it. Each figure is printed on a
 * `SMOKE_PERF` line so two runs can be compared side by side.
 *
 * The page figures are read in the renderer, against its own clock, and the
 * native ones in this process; both are turned into wall time with each
 * clock's `timeOrigin`, so "the caption buttons changed this long before the
 * page did" is one subtraction.
 */
import { BrowserWindow, nativeTheme } from "electron";
import { performance } from "node:perf_hooks";
import type { RemoteHeader } from "./services/mail-source";
import { configureMailboxSource } from "./services/mail-source";
import * as settings from "./services/settings";
import { closeSetupWindow, getSettingsWindow, openSettingsWindow } from "./windows";
import { startIpcTimings } from "./ipc/lock-guard";

export interface BootMarks {
	/** `performance.now()` in this process at `app.whenReady()`. */
	ready: number;
	/** When the main window was constructed. */
	windowCreated: number;
	/** When it fired ready-to-show, or null if it has not yet. */
	readyToShow: number | null;
}

const THREADS = 400;
const PER_THREAD = 3;

/**
 * A screen still changing ten seconds after it opened is a render loop, not a
 * slow screen: a breadcrumb that republished itself once kept Mail and every
 * open page re-rendering thousands of times a second, and nothing else in the
 * smoke run could see it. Such a screen fails the run.
 */
const NEVER_SETTLES_MS = 9000;
const unsettled: string[] = [];

function checkSettled(name: string, values: Record<string, number | string>): void {
	if (typeof values.done === "number" && values.done >= NEVER_SETTLES_MS) unsettled.push(`${name} (${String(values.busiest ?? "")})`);
}

function print(name: string, values: Record<string, number | string>): void {
	checkSettled(name, values);
	const pairs = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	console.log(`SMOKE_PERF ${name} ${pairs.join(" ")}`);
}

function wall(): number {
	return performance.timeOrigin + performance.now();
}

/** A mailbox of four hundred conversations of three messages each, in memory. */
function perfMailbox() {
	const start = Date.now() - THREADS * PER_THREAD * 60 * 60 * 1000;
	const messages = Array.from({ length: THREADS * PER_THREAD }, (_, index) => {
		const thread = Math.floor(index / PER_THREAD);
		const step = index % PER_THREAD;
		const uid = index + 1;
		const date = new Date(start + index * 60 * 60 * 1000).toISOString();
		const subject = `${step ? "Re: " : ""}Perf thread ${String(thread).padStart(4, "0")}`;
		const messageId = `<perf-${thread}-${step}@perf.test>`;
		const inReplyTo = step ? `<perf-${thread}-${step - 1}@perf.test>` : null;
		const from = { name: `Sender ${thread % 50}`, address: `sender${thread % 50}@perf.test` };
		const source = [
			`From: ${from.name} <${from.address}>`,
			"To: hallo@juno.test",
			`Subject: ${subject}`,
			`Message-ID: ${messageId}`,
			...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
			`Date: ${new Date(date).toUTCString()}`,
			"MIME-Version: 1.0",
			'Content-Type: text/plain; charset="utf-8"',
			"",
			`Bericht ${step + 1} in gesprek ${thread}. `.repeat(20),
		].join("\r\n");
		const header: RemoteHeader = {
			uid,
			flags: step === PER_THREAD - 1 && thread % 3 === 0 ? [] : ["\\Seen"],
			internalDate: date,
			size: source.length,
			envelope: {
				date,
				subject,
				messageId,
				inReplyTo,
				references: inReplyTo ? [inReplyTo] : [],
				from,
				to: [{ name: null, address: "hallo@juno.test" }],
				cc: [],
				replyTo: [],
			},
			hasAttachments: false,
		};
		return { uid, header, source };
	});

	return async () => {
		let current = "INBOX";
		const inbox = () => (current === "INBOX" ? messages : []);
		return {
			async listFolders() {
				return [
					{ path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "inbox" as const },
					{ path: "Sent", name: "Sent", delimiter: "/", specialUse: "sent" as const },
				];
			},
			async openFolder(path: string) {
				current = path;
				return { uidValidity: "1", uidNext: inbox().length + 1, exists: inbox().length };
			},
			async searchUids() {
				return inbox().map((message) => message.uid);
			},
			async fetchHeaders(uids: number[]) {
				const wanted = new Set(uids);
				return inbox().filter((message) => wanted.has(message.uid)).map((message) => message.header);
			},
			async fetchFlags(uids: number[]) {
				const wanted = new Set(uids);
				return inbox()
					.filter((message) => wanted.has(message.uid))
					.map((message) => ({ uid: message.uid, flags: message.header.flags }));
			},
			async fetchSource(uid: number) {
				const message = inbox().find((entry) => entry.uid === uid);
				return message ? Buffer.from(message.source) : null;
			},
			async close() {
				return;
			},
		};
	};
}

/**
 * Helpers every measuring script starts with. `settle` waits for the page to
 * stop changing: no mutation for 150ms and no skeleton left, and reports when
 * the last change happened, which is when a person would call it loaded.
 */
const HELPERS = `
	const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const longTasks = [];
	const lt = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e.duration); });
	try { lt.observe({ type: "longtask" }); } catch {}
	const frames_ = [];
	const lf = new PerformanceObserver((list) => { for (const e of list.getEntries()) frames_.push(e); });
	try { lf.observe({ type: "long-animation-frame" }); } catch {}
	// Where the long frames went: script, style and layout, and the rest
	// (paint and what follows), with the three scripts that took longest.
	const takeFrames = () => {
		const all = frames_.splice(0);
		let script = 0, render = 0, rest = 0;
		const sources = new Map();
		for (const f of all) {
			const renderStart = f.renderStart || f.startTime + f.duration;
			const styleStart = f.styleAndLayoutStart || renderStart;
			script += f.scripts.reduce((sum, s) => sum + s.duration, 0);
			render += Math.max(0, f.startTime + f.duration - styleStart);
			rest += Math.max(0, styleStart - renderStart);
			for (const s of f.scripts) {
				const key = (s.invoker || "?") + "@" + (s.sourceFunctionName || "") + ":" + String(s.sourceURL || "").split("/").pop() + ":" + s.sourceCharPosition;
				sources.set(key, (sources.get(key) || 0) + s.duration);
			}
		}
		const top = [...sources].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k.replace(/\\s+/g, "_") + "=" + Math.round(v)).join(",");
		return { frames: all.length, script_ms: Math.round(script), style_layout_ms: Math.round(render), raf_ms: Math.round(rest), top: top || "none" };
	};
	const takeLong = () => { const all = longTasks.splice(0); return { long: Math.round(all.reduce((a, b) => a + b, 0)), longest: Math.round(Math.max(0, ...all)) }; };
	const settle = async (start, timeout = 10000) => {
		let last = performance.now();
		let firstFrame = -1;
		const where = new Map();
		const observer = new MutationObserver((records) => {
			last = performance.now();
			// What keeps changing, for a screen that never settles.
			for (const record of records) {
				const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
				const label = node ? (node.closest("[aria-label]")?.getAttribute("aria-label") ?? node.tagName) + "." + record.type + (record.attributeName ? ":" + record.attributeName : "") : "?";
				where.set(label, (where.get(label) || 0) + 1);
			}
		});
		observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
		while (performance.now() - start < timeout) {
			await frame();
			if (firstFrame < 0) firstFrame = Math.round(performance.now() - start);
			const busy = document.querySelector("main .animate-pulse, main [aria-busy=true]");
			if (!busy && performance.now() - last > 150) break;
		}
		observer.disconnect();
		const done = Math.round(last - start);
		const busiest = done > 1000 ? [...where].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k.replace(/\\s+/g, "_") + "=" + v).join(",") : "";
		return { first: firstFrame, done, ...(busiest ? { busiest } : {}) };
	};
	const nav = (id) => document.querySelector("nav button[data-nav=" + id + "]");
	const find = (selector, text) => [...document.querySelectorAll(selector)].find((node) => node.textContent.includes(text));
	const appear = async (selector, text, timeout = 5000) => {
		const start = performance.now();
		while (performance.now() - start < timeout) {
			const el = find(selector, text);
			if (el) return el;
			await frame();
		}
		return null;
	};

`;

async function seed(window: BrowserWindow): Promise<Record<string, number>> {
	configureMailboxSource(perfMailbox());
	return (await window.webContents.executeJavaScript(`(async () => {
		const b = window.juno;
		const t0 = performance.now();
		const clients = [];
		for (let i = 0; i < 500; i++) {
			clients.push(await b.clients.create({ name: "Perf client " + String(i).padStart(3, "0") }));
		}
		const projects = [];
		for (let i = 0; i < 150; i++) {
			projects.push(await b.projects.create({ name: "Perf project " + String(i).padStart(3, "0"), clientId: clients[i % 40].id }));
		}
		for (let i = 0; i < 300; i++) {
			await b.notes.create({ title: "Perf note " + i, body: "Regel een\\nRegel twee\\nRegel drie", clientId: i % 3 === 0 ? clients[i % 40].id : null });
		}
		const today = new Date();
		for (let i = 0; i < 400; i++) {
			const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60 + Math.floor(i / 3));
			const pad = (n) => String(n).padStart(2, "0");
			const hour = 8 + (i % 3) * 3;
			const local = day.getFullYear() + "-" + pad(day.getMonth() + 1) + "-" + pad(day.getDate()) + "T" + pad(hour) + ":00";
			const end = day.getFullYear() + "-" + pad(day.getMonth() + 1) + "-" + pad(day.getDate()) + "T" + pad(hour + 1) + ":30";
			await b.calendar.create({ title: "Perf event " + i, startLocal: local, endLocal: end, clientId: clients[i % 40].id });
		}
		for (let i = 0; i < 60; i++) {
			await b.pages.create({ title: "Perf page " + String(i).padStart(2, "0"), clientId: clients[i % 40].id });
		}
		const records = Math.round(performance.now() - t0);
		const t1 = performance.now();
		await b.mail.accounts.create({ email: "hallo@juno.test", label: "Juno", imapHost: "imap.juno.test", smtpHost: "smtp.juno.test", password: "smoke" });
		await b.mail.sync.run();
		const mail = Math.round(performance.now() - t1);
		return { records, mail };
	})()`)) as Record<string, number>;
}

/** Waits for the main window to load again, and for the shell to say it mounted. */
async function reload(window: BrowserWindow): Promise<number> {
	const started = wall();
	await new Promise<void>((resolve) => {
		window.webContents.once("did-finish-load", () => resolve());
		window.webContents.reload();
	});
	const shell = (await window.webContents.executeJavaScript(`(async () => {
		for (let i = 0; i < 400; i++) {
			const mark = performance.getEntriesByName("juno:shell")[0];
			if (mark) return performance.timeOrigin + mark.startTime;
			await new Promise((r) => setTimeout(r, 10));
		}
		return -1;
	})()`)) as number;
	return Math.round(shell - started);
}

async function boot(window: BrowserWindow, marks: BootMarks): Promise<void> {
	const page = (await window.webContents.executeJavaScript(`(() => {
		const fcp = performance.getEntriesByName("first-contentful-paint")[0];
		const shell = performance.getEntriesByName("juno:shell")[0];
		return { origin: performance.timeOrigin, fcp: fcp ? fcp.startTime : -1, shell: shell ? shell.startTime : -1 };
	})()`)) as { origin: number; fcp: number; shell: number };
	const toWall = (relative: number) => performance.timeOrigin + relative;
	const fromStart = (absolute: number) => Math.round(absolute - performance.timeOrigin);
	print("boot", {
		ready_ms: Math.round(marks.ready),
		window_ms: Math.round(marks.windowCreated),
		ready_to_show_ms: marks.readyToShow === null ? -1 : Math.round(marks.readyToShow),
		first_paint_ms: page.fcp < 0 ? -1 : fromStart(page.origin + page.fcp),
		shell_ms: page.shell < 0 ? -1 : fromStart(page.origin + page.shell),
		ready_to_shell_ms: page.shell < 0 ? -1 : Math.round(page.origin + page.shell - toWall(marks.ready)),
	});
}

async function screens(window: BrowserWindow): Promise<void> {
	for (const pass of ["first", "again"]) {
		const ipc = startIpcTimings();
		const results = (await window.webContents.executeJavaScript(`(async () => {
			${HELPERS}
			const out = [];
			// The words that say the screen's own records have arrived, which a
			// screen with no skeleton cannot otherwise be told apart from loaded.
			const expect = { overview: "", calendar: "Perf event", clients: "Perf client", projects: "Perf project", mail: "Perf thread", notes: "Perf note", documents: "Perf page" };
			for (const id of Object.keys(expect)) {
				await wait(300);
				takeLong();
				takeFrames();
				const start = performance.now();
				nav(id).click();
				let shown = -1;
				while (performance.now() - start < 5000) {
					if ((document.querySelector("main")?.textContent ?? "").includes(expect[id])) { shown = Math.round(performance.now() - start); break; }
					await frame();
				}
				const time = await settle(start);
				out.push({ id, shown,  ...time, ...takeLong(), nodes: document.querySelectorAll("main *").length, ...takeFrames() });
			}
			nav("overview").click();
			await wait(400);
			return out;
		})()`)) as Array<Record<string, number | string>>;
		const calls = ipc();
		for (const result of results) {
			const { id, ...rest } = result;
			print(`screen.${pass}.${String(id)}`, rest as Record<string, number>);
		}
		print(`ipc.screens.${pass}`, {
			calls: calls.reduce((sum, entry) => sum + entry.count, 0),
			main_ms: Math.round(calls.reduce((sum, entry) => sum + entry.total, 0)),
			slowest: calls[0] ? `${calls[0].channel}:${Math.round(calls[0].max)}` : "none",
		});
		for (const entry of calls.slice(0, 6)) {
			print(`ipc.${pass}.top`, { channel: entry.channel, count: entry.count, total_ms: Math.round(entry.total), max_ms: Math.round(entry.max) });
		}
	}
}

async function records(window: BrowserWindow): Promise<void> {
	const steps: Array<{ name: string; screen: string; selector: string; text: string }> = [
		{ name: "client", screen: "clients", selector: "main tbody tr", text: "Perf client 007" },
		{ name: "project", screen: "projects", selector: "main button, main a, main tr, main li", text: "Perf project 003" },
		{ name: "thread", screen: "mail", selector: "main li, main button, main tr, main [role=row]", text: "Perf thread 0398" },
		{ name: "page", screen: "documents", selector: "main ul li button, main tr", text: "Perf page 05" },
		{ name: "note", screen: "notes", selector: "main button", text: "Perf note 29" },
	];
	for (const step of steps) {
		const ipc = startIpcTimings();
		const result = (await window.webContents.executeJavaScript(`(async () => {
			${HELPERS}
			nav(${JSON.stringify(step.screen)}).click();
			await settle(performance.now());
			const target = await appear(${JSON.stringify(step.selector)}, ${JSON.stringify(step.text)});
			if (!target) return { missing: 1 };
			await wait(300);
			takeLong();
			takeFrames();
			const start = performance.now();
			(target.closest("button, a, tr, [role=row], [role=button]") ?? target).click();
			const time = await settle(start);
			const out = { ...time, ...takeLong(), ...takeFrames() };
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			nav("overview").click();
			await wait(400);
			return out;
		})()`)) as Record<string, number>;
		const calls = ipc();
		print(`open.${step.name}`, {
			...result,
			ipc_calls: calls.reduce((sum, entry) => sum + entry.count, 0),
			ipc_main_ms: Math.round(calls.reduce((sum, entry) => sum + entry.total, 0)),
		});
	}

	// The Clients list with five hundred rows: how soon the first and the last
	// arrive, and what a fast scroll costs per frame.
	const list = (await window.webContents.executeJavaScript(`(async () => {
		${HELPERS}
		takeLong();
		takeFrames();
		const start = performance.now();
		nav("clients").click();
		let first = -1;
		let rows = 0;
		while (performance.now() - start < 10000) {
			rows = document.querySelectorAll("main tbody tr").length;
			if (rows > 0 && first < 0) first = Math.round(performance.now() - start);
			if (rows >= 500) break;
			await frame();
		}
		const all = Math.round(performance.now() - start);
		const scroller = [...document.querySelectorAll("main *")].find((el) => el.scrollHeight > el.clientHeight + 200 && getComputedStyle(el).overflowY !== "visible");
		const frames = [];
		if (scroller) {
			let last = performance.now();
			for (let i = 0; i < 60; i++) {
				scroller.scrollTop += 400;
				await frame();
				const now = performance.now();
				frames.push(now - last);
				last = now;
			}
		}
		const out = { rows, first_row_ms: first, all_rows_ms: all, frame_mean: Math.round(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)), frame_worst: Math.round(Math.max(0, ...frames)), ...takeLong(), ...takeFrames() };
		nav("overview").click();
		await wait(400);
		return out;
	})()`)) as Record<string, number>;
	print("list.clients", list);
}

/**
 * Installs a watcher in a window that reports, on wall time, the first frame
 * whose page background differs from the one before the switch, and counts the
 * CSS transitions the switch started.
 */
const WATCH = `(() => {
	const before = getComputedStyle(document.body).backgroundColor;
	const state = { changed: -1, transitions: 0, done: false };
	const count = () => { state.transitions += 1; };
	document.addEventListener("transitionrun", count, true);
	const tick = () => {
		if (state.done) return;
		if (getComputedStyle(document.body).backgroundColor !== before && state.changed < 0) {
			state.changed = performance.timeOrigin + performance.now();
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	window.__perfTheme = { state, stop: () => { state.done = true; document.removeEventListener("transitionrun", count, true); return state; } };
	return true;
})()`;

async function themeSwitch(window: BrowserWindow, from: BrowserWindow, label: string): Promise<void> {
	const targets = [window, ...(from === window ? [] : [from])];
	const sequence = ["dark", "light", "dark", "system", "light"] as const;
	const page: number[] = [];
	const other: number[] = [];
	const transitions: number[] = [];
	const total: number[] = [];
	await settings.setTheme("light");
	nativeTheme.themeSource = "light";
	for (const theme of sequence) {
		await new Promise((r) => setTimeout(r, 500));
		for (const target of targets) await target.webContents.executeJavaScript(WATCH);
		let native = -1;
		const onNative = () => {
			if (native < 0) native = wall();
		};
		nativeTheme.once("updated", onNative);
		const started = wall();
		await from.webContents.executeJavaScript(`window.juno.settings.setTheme(${JSON.stringify(theme)})`);
		await new Promise((r) => setTimeout(r, 600));
		nativeTheme.off("updated", onNative);
		const states = [] as Array<{ changed: number; transitions: number }>;
		for (const target of targets) {
			states.push((await target.webContents.executeJavaScript(`window.__perfTheme.stop()`)) as { changed: number; transitions: number });
		}
		// "system" on a light machine is no change after light; only switches
		// that changed something are counted.
		if (states[0]!.changed < 0) continue;
		page.push(Math.round(states[0]!.changed - (native < 0 ? started : native)));
		if (states[1] && states[1].changed > 0) other.push(Math.round(states[1].changed - (native < 0 ? started : native)));
		transitions.push(states.reduce((sum, state) => sum + state.transitions, 0));
		total.push(Math.round(Math.max(...states.map((state) => state.changed)) - started));
	}
	const median = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : -1);
	print(`theme.${label}`, {
		switches: page.length,
		main_page_after_native_ms: median(page),
		settings_page_after_native_ms: median(other),
		transitions_started: median(transitions),
		click_to_last_page_ms: median(total),
	});
}

export async function runPerfProbe(window: BrowserWindow, marks: BootMarks): Promise<void> {
	const now = new Date().toISOString();
	await settings.setOnboarding({ completedAt: now, walkthroughSeenAt: now });
	closeSetupWindow();
	// A covered window is not composited and its animation frames stop, which
	// would time the occlusion rather than the app (verify.md, capturePage).
	if (process.env.JUNO_SMOKE_FRONT) {
		window.setAlwaysOnTop(true);
		window.show();
		window.focus();
	}
	await boot(window, marks);

	const seeded = await seed(window);
	print("seed", seeded);
	print("reload", { shell_ms: await reload(window) });

	await screens(window);
	await records(window);
	if (unsettled.length > 0) {
		throw new Error(`Smoke: these never stopped changing, which is a render loop: ${unsettled.join("; ")}`);
	}

	await themeSwitch(window, window, "main");
	openSettingsWindow("general");
	let settingsWindow = getSettingsWindow();
	for (let i = 0; i < 50 && (!settingsWindow || settingsWindow.webContents.isLoading()); i++) {
		await new Promise((r) => setTimeout(r, 100));
		settingsWindow = getSettingsWindow();
	}
	if (settingsWindow) {
		await new Promise((r) => setTimeout(r, 800));
		await themeSwitch(window, settingsWindow, "from_settings");
		settingsWindow.close();
	}
	await settings.setTheme("system");
	nativeTheme.themeSource = "system";
	if (process.env.JUNO_SMOKE_FRONT) window.setAlwaysOnTop(false);
}
