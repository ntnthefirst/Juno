/**
 * The file worker: a `worker_threads` thread the main process starts the first
 * time a file has to be parsed (`services/file-reader.ts`), so reading a large
 * Word file or workbook never holds the thread every window runs on.
 *
 * It takes one request at a time, runs it through `services/file-jobs.ts` and
 * posts the answer back. It keeps nothing between jobs except the libraries it
 * has loaded, so the main process may end it at any moment, which is how a job
 * that runs past its time limit is stopped.
 *
 * Compiled to `dist-electron/main/workers/file-worker.js`, beside the rest of
 * the main process, and read from inside `app.asar` in a packaged build.
 */
import { parentPort } from "node:worker_threads";
import { runFileJob, type FileJobReply, type FileJobRequest, type FileWorkerReady } from "../services/file-jobs";

const port = parentPort;
if (!port) throw new Error("The file worker runs as a worker thread of the main process only.");

port.on("message", (request: FileJobRequest) => {
	void runFileJob(request.job, request.bytes).then(
		(value) => port.postMessage({ id: request.id, ok: true, value } satisfies FileJobReply),
		(error: unknown) =>
			port.postMessage({
				id: request.id,
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			} satisfies FileJobReply),
	);
});

// Loading the libraries above is part of starting, not of the first job, so
// the first job's time limit starts only once this has been said.
port.postMessage({ ready: true } satisfies FileWorkerReady);
