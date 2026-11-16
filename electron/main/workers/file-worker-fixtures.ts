/**
 * The file worker for tests, loaded before every test file (`vitest.config.ts`).
 *
 * The application starts the compiled worker from `dist-electron`. A test runs
 * against the TypeScript sources, which a worker thread cannot load by itself,
 * so this starts one that first teaches `require` to read a `.ts` file through
 * the TypeScript compiler, then loads `workers/file-worker.ts`. The worker is
 * the same code the application runs; only the way it is loaded differs.
 *
 * Never imported by application code.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { configureFileReader, type WorkerSource } from "../services/file-reader";

const LOADER = `
const { workerData } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const ts = require(workerData.typescript);
Module._extensions[".ts"] = (module, filename) => {
	const output = ts.transpileModule(readFileSync(filename, "utf8"), {
		fileName: filename,
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
	});
	module._compile(output.outputText, filename);
};
require(workerData.entry);
`;

/** The worker as tests start it: the real worker module, compiled as it loads. */
export function sourceWorker(): WorkerSource {
	const root = process.cwd();
	return {
		code: LOADER,
		workerData: {
			typescript: createRequire(resolve(root, "package.json")).resolve("typescript"),
			entry: resolve(root, "electron/main/workers/file-worker.ts"),
		},
	};
}

/** Code for a worker that is not the real one: answers each job with `answer`, a function body of `(job, threadId)`. */
export function fakeWorker(answer: string): WorkerSource {
	return {
		code: `
const { parentPort, threadId } = require("node:worker_threads");
const answer = (job, threadId) => { ${answer} };
parentPort.on("message", async (request) => {
	try {
		const value = await answer(request.job, threadId);
		if (value !== undefined) parentPort.postMessage({ id: request.id, ok: true, value });
	} catch (error) {
		parentPort.postMessage({ id: request.id, ok: false, message: error.message });
	}
});
parentPort.postMessage({ ready: true });
`,
	};
}

configureFileReader({ source: sourceWorker() });
