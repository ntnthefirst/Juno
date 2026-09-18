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

// Documents are rendered to PDF in an offscreen window, which has no access to
// the renderer's bundled fonts. The two faces the document stylesheet needs are
// copied here and embedded as data URIs at render time, so a contract looks the
// same on every machine instead of falling back to whatever the OS has.
const fontsOut = join(out, "fonts");
mkdirSync(fontsOut, { recursive: true });
for (const face of ["inter-latin-400-normal.woff2", "inter-latin-600-normal.woff2"]) {
	cpSync(join(root, "node_modules", "@fontsource", "inter", "files", face), join(fontsOut, face));
}

console.log("dist-electron: package.json written, migrations and fonts copied");
