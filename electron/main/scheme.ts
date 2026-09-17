/**
 * Serves the packaged renderer over `app://bundle/` instead of `file://`.
 *
 * `file://` is an opaque origin. It skips `onHeadersReceived`, so a
 * Content-Security-Policy header set there applies in development and then
 * silently vanishes from the build people install, which is the worst possible
 * shape for a security control to have.
 *
 * A custom standard scheme also gives the renderer a real origin, which is what
 * makes `localStorage`, `fetch` and module scripts behave predictably.
 */
import { net, protocol } from "electron";
import { normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const APP_ORIGIN = "app://bundle";

/** Must be called before `app.whenReady()`, or Electron ignores it. */
export function registerAppSchemePrivileges(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: "app",
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
			},
		},
	]);
}

export function registerAppScheme(rootDir: string): void {
	const root = resolve(rootDir);

	protocol.handle("app", async (request) => {
		const url = new URL(request.url);

		if (url.host !== "bundle") return new Response("Not found", { status: 404 });

		let pathname = decodeURIComponent(url.pathname);
		if (pathname === "" || pathname === "/") pathname = "/index.html";

		const target = normalize(resolve(root, `.${pathname}`));

		// Containment check. Without it, app://bundle/../../../etc/passwd reads
		// whatever the user account can read. Comparing with a trailing separator
		// stops "/root-evil" matching a root of "/root".
		if (target !== root && !target.startsWith(root + sep)) {
			return new Response("Forbidden", { status: 403 });
		}

		try {
			return await net.fetch(pathToFileURL(target).toString());
		} catch {
			// A client-side router asking for a path that is not a file should get
			// the shell back, not a 404.
			return net.fetch(pathToFileURL(resolve(root, "index.html")).toString());
		}
	});
}
