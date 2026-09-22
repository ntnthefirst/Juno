/**
 * Where a development run keeps its data.
 *
 * Beside the installed application's folder, never inside it. A dev run that
 * writes to the real `Juno` directory can migrate, seed or corrupt records a
 * business actually depends on, and there is no undo for that.
 *
 * The main process reads JUNO_DEV_DATA and uses this same default when it is
 * unset, so there is one answer whichever side asks.
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const DEV_DIR_NAME = "Juno (dev)";

export function devDataDir() {
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
