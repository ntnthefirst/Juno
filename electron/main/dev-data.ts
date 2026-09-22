/**
 * Where a development run keeps its data.
 *
 * Beside the installed application's folder, never inside it. A dev run that
 * writes to the real `Juno` directory can migrate, seed or corrupt records a
 * business actually depends on, and there is no undo for that.
 *
 * `scripts/dev-data.mjs` computes the same path, and `npm run dev` passes it in
 * as JUNO_DEV_DATA so the one that gets cleaned and the one that gets used are
 * the same directory by construction, not by two formulas agreeing.
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const DEV_DIR_NAME = "Juno (dev)";

export function devDataDir(): string {
	if (process.env.JUNO_DEV_DATA) return process.env.JUNO_DEV_DATA;

	switch (platform()) {
		case "win32":
			return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), DEV_DIR_NAME);
		case "darwin":
			return join(homedir(), "Library", "Application Support", DEV_DIR_NAME);
		default:
			return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), DEV_DIR_NAME);
	}
}
