import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// One window, one entry. The lock screen is a state inside the app, not a second
// window, so that locking cannot be bypassed by whatever is already loaded.
export default defineConfig({
	plugins: [react(), tailwindcss()],
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
		port: 5173,
		strictPort: true,
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
