// The repo is "type": "module", so anything ending in .js is treated as ESM.
// The main process compiles to CommonJS, so dist-electron needs its own
// package.json saying so. Without this, Electron throws
// "require is not defined in ES module scope" on the first launch after a build.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist-electron");

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }, null, "\t") + "\n");

// tsc only emits .ts. The migrations are .sql and the app reads them at runtime
// relative to __dirname, so they have to be carried across by hand. Forgetting
// this produces an app that boots to an empty database with no error.
const from = join(root, "electron", "main", "db", "migrations");
const to = join(out, "main", "db", "migrations");
cpSync(from, to, { recursive: true });

console.log("dist-electron: package.json written, migrations copied");
