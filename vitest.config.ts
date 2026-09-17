import { defineConfig } from "vitest/config";

/**
 * Tests run under Electron's Node, not the host's. `node:sqlite` in Node 23 has
 * no `StatementSync.setReturnArrays`, which the shim's `raw()` needs, so every
 * Drizzle select throws there. Electron 41 bundles Node 24.18, which has it.
 * See the `test` script in package.json.
 */
export default defineConfig({
	test: {
		include: ["electron/**/*.test.ts", "src/**/*.test.ts"],
		// dist-electron holds compiled copies of the same tests. Collecting those
		// runs every test twice and fails on require("vitest").
		exclude: ["node_modules/**", "dist/**", "dist-electron/**", "release/**"],
		environment: "node",
	},
});
