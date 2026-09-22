import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { DEV_CSP_NONCE, DEV_PORT } from "./electron/shared/dev.ts";

// One window, one entry. The lock screen is a state inside the app, not a second
// window, so that locking cannot be bypassed by whatever is already loaded.
export default defineConfig(({ command }) => ({
	plugins: [react(), tailwindcss()],
	// Stamps the nonce on the tags Vite injects, so the React refresh preamble
	// survives the renderer's content policy. Serve only: a built page carries
	// no inline script, and a nonce attribute in it would match nothing.
	html: command === "serve" ? { cspNonce: DEV_CSP_NONCE } : undefined,
	// The packaged renderer is served over the app:// scheme, so every asset URL
	// has to be relative rather than rooted at "/".
	base: "./",
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@shared": fileURLToPath(new URL("./electron/shared", import.meta.url)),
		},
	},
	server: {
		port: DEV_PORT,
		// The main process waits on this exact port and allows it by name in the
		// content policy, so a silent move to 5174 is a window that never loads.
		strictPort: true,
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
}));
