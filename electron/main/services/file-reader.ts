/**
 * How the main process has a file parsed without being held by it: the job
 * goes to the file worker (`workers/file-worker.ts`), a `worker_threads`
 * thread started the first time it is needed and kept for the next job.
 *
 * - **One job at a time**, in the order asked. The time limit of a job starts
 *   when the worker is handed it, not while it waits behind another or while
 *   the worker is still loading its libraries.
 * - **The bytes are moved, not copied**, when the caller says it will not use
 *   them again (`transfer`). Otherwise one copy is made and that is moved, so
 *   the caller's buffer is never taken from under it.
 * - **A job past its time limit ends the worker.** A parser stuck in a loop
 *   cannot be interrupted any other way. The caller gets a sentence it can show
 *   (`FileReadError`), and the next job starts a fresh worker.
 * - **The worker has a memory ceiling of its own**, so a file that would take
 *   gigabytes to read ends the worker, not Juno.
 *
 * No Electron import. The worker's file is found from `__dirname`, which in a
 * packaged build is inside `app.asar`; a worker thread reads from there like
 * the main process does. Tests point it at the TypeScript source instead
 * (`workers/file-worker-fixtures.ts`).
 */
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type {
	FileJob,
	FileJobKind,
	FileJobOutput,
	FileJobReply,
	FileJobRequest,
	FileWorkerReady,
} from "./file-jobs";

/** How long one job may take before the worker is ended. A preview nobody waits thirty seconds for. */
export const READ_TIME_LIMIT_MS = 30_000;
/** An idle worker is ended after this, so the libraries it loaded do not stay in memory all day. */
const IDLE_MS = 60_000;
/** The worker's own heap ceiling. Well past what any file inside the size limits needs. */
const WORKER_HEAP_MB = 2048;

/** A failure of the reading itself, rather than of the file, said as a sentence a person can act on. */
export class FileReadError extends Error {
	override name = "FileReadError";
}

/** Where the worker's code comes from: its compiled file, or code to evaluate (tests). */
export type WorkerSource = { file: string } | { code: string; workerData?: unknown };

export interface ReadOptions {
	/** The file's name, for the sentence a person is shown when reading it fails. */
	fileName?: string;
	/** The caller will not touch the bytes again, so they are moved to the worker instead of copied. */
	transfer?: boolean;
}

interface Pending {
	id: number;
	job: FileJob;
	bytes: Uint8Array;
	transfer: boolean;
	fileName: string | null;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface Running {
	worker: Worker;
	/** False until the worker says its libraries are loaded. */
	ready: boolean;
	/** The job it is doing, if any. */
	job: Pending | null;
	/** The time limit of starting, then of the job. */
	timer: NodeJS.Timeout | null;
}

let source: WorkerSource | null = null;
let timeLimit = READ_TIME_LIMIT_MS;
let current: Running | null = null;
const queue: Pending[] = [];
let idleTimer: NodeJS.Timeout | null = null;
let nextId = 1;

function defaultSource(): WorkerSource {
	// dist-electron/main/services/file-reader.js finds dist-electron/main/workers/file-worker.js.
	return { file: join(__dirname, "..", "workers", "file-worker.js") };
}

function named(fileName: string | null): string {
	return fileName ? `"${fileName}"` : "this file";
}

function timedOut(fileName: string | null): FileReadError {
	const seconds = Math.max(1, Math.round(timeLimit / 1000));
	return new FileReadError(
		`Juno stopped reading ${named(fileName)} after ${seconds} ${seconds === 1 ? "second" : "seconds"}. Open it in the app that made it.`,
	);
}

function lostWorker(fileName: string | null, error: Error | null): FileReadError {
	const code = error && "code" in error ? error.code : null;
	if (code === "ERR_WORKER_OUT_OF_MEMORY") {
		return new FileReadError(`Reading ${named(fileName)} needs more memory than Juno allows. Open it in the app that made it.`);
	}
	return new FileReadError(`Juno could not finish reading ${named(fileName)}. Try again, or open it in the app that made it.`);
}

/**
 * Replaces where the worker comes from and how long a job may take, ending
 * the worker that is running. For tests; the application keeps the defaults.
 */
export function configureFileReader(options: { source?: WorkerSource | null; timeLimitMs?: number } = {}): void {
	stopFileReader();
	source = options.source ?? null;
	timeLimit = options.timeLimitMs ?? READ_TIME_LIMIT_MS;
}

/** Ends the worker, and fails whatever it was doing or had waiting. */
export function stopFileReader(): void {
	const waiting = [...(current?.job ? [current.job] : []), ...queue.splice(0)];
	end();
	for (const pending of waiting) pending.reject(new FileReadError(`Juno stopped reading ${named(pending.fileName)}.`));
}

function clearIdle(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
}

/** Ends the worker that runs, if one does, without touching the queue. */
function end(): void {
	clearIdle();
	const stopping = current;
	current = null;
	if (!stopping) return;
	if (stopping.timer) clearTimeout(stopping.timer);
	void stopping.worker.terminate().catch(() => undefined);
}

function start(): Running {
	const from = source ?? defaultSource();
	const options = { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } };
	const worker =
		"file" in from
			? new Worker(from.file, options)
			: new Worker(from.code, { ...options, eval: true, workerData: from.workerData });
	// The worker alone never keeps Juno running. A job in flight has its timer, which does.
	worker.unref();
	const running: Running = { worker, ready: false, job: null, timer: null };
	worker.on("message", (message: FileJobReply | FileWorkerReady) => {
		if (current !== running) return;
		if ("ready" in message) {
			running.ready = true;
			if (running.timer) clearTimeout(running.timer);
			running.timer = null;
			pump();
		} else {
			settle(running, message);
		}
	});
	worker.on("error", (error: Error) => {
		if (current === running) lose(running, error);
	});
	worker.on("exit", () => {
		if (current === running) lose(running, null);
	});
	// A worker that cannot even load its libraries in the time a job gets is
	// as stuck as a job that runs past it.
	running.timer = setTimeout(() => {
		if (current === running) lose(running, null);
	}, timeLimit);
	return running;
}

function settle(running: Running, reply: FileJobReply): void {
	const pending = running.job;
	if (!pending || reply.id !== pending.id) return;
	if (running.timer) clearTimeout(running.timer);
	running.timer = null;
	running.job = null;
	if (reply.ok) pending.resolve(reply.value);
	else pending.reject(new Error(reply.message));
	pump();
}

/**
 * The worker ended on its own: it threw outside a job, ran out of memory, or
 * never finished starting. What it was doing fails, or the first job waiting
 * for it when it died while starting, so a worker that cannot start at all is
 * not started again for ever.
 */
function lose(running: Running, error: Error | null): void {
	const failed = running.job ?? (running.ready ? null : queue.shift() ?? null);
	end();
	failed?.reject(lostWorker(failed.fileName, error));
	pump();
}

function overrun(running: Running): void {
	const pending = running.job;
	if (current !== running || !pending) return;
	end();
	pending.reject(timedOut(pending.fileName));
	pump();
}

/** The bytes the worker is given: the caller's own when it gave them away whole, a copy otherwise. */
function handOver(pending: Pending): { bytes: Uint8Array; buffer: ArrayBuffer } {
	const { bytes } = pending;
	const buffer = bytes.buffer;
	if (pending.transfer && buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
		return { bytes, buffer };
	}
	const copy = new Uint8Array(bytes);
	return { bytes: copy, buffer: copy.buffer };
}

function pump(): void {
	if (current?.job) return;
	if (queue.length === 0) {
		if (current && !idleTimer) {
			idleTimer = setTimeout(() => {
				idleTimer = null;
				if (!current?.job && queue.length === 0) end();
			}, IDLE_MS);
			idleTimer.unref();
		}
		return;
	}
	clearIdle();
	let running: Running;
	try {
		running = current ??= start();
	} catch (error) {
		const failed = queue.shift();
		failed?.reject(lostWorker(failed.fileName, error instanceof Error ? error : null));
		pump();
		return;
	}
	if (!running.ready) return;
	const pending = queue.shift()!;
	try {
		const { bytes, buffer } = handOver(pending);
		const request: FileJobRequest = { id: pending.id, job: pending.job, bytes };
		running.job = pending;
		running.timer = setTimeout(() => overrun(running), timeLimit);
		running.worker.postMessage(request, [buffer]);
	} catch (error) {
		end();
		pending.reject(lostWorker(pending.fileName, error instanceof Error ? error : null));
		pump();
	}
}

/**
 * Runs one job in the file worker and answers with what it made. Rejects with
 * the library's own error for a file it cannot read, and with a
 * `FileReadError` when the job ran out of time or the worker was lost.
 */
export function readInWorker<K extends FileJobKind>(
	job: Extract<FileJob, { kind: K }>,
	bytes: Uint8Array,
	options: ReadOptions = {},
): Promise<FileJobOutput[K]> {
	return new Promise<FileJobOutput[K]>((resolve, reject) => {
		queue.push({
			id: nextId++,
			job,
			bytes,
			transfer: options.transfer ?? false,
			fileName: options.fileName ?? null,
			// The worker answers the kind of job it was asked, so its value is that kind's output.
			resolve: (value) => resolve(value as FileJobOutput[K]),
			reject,
		});
		pump();
	});
}
