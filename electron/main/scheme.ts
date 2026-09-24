/**
 * Serves the packaged renderer over `app://bundle/` instead of `file://`, and
 * message bodies over `app://mail/`.
 *
 * `file://` is an opaque origin. It skips `onHeadersReceived`, so a
 * Content-Security-Policy header set there applies in development and then
 * silently vanishes from the build people install, which is the worst possible
 * shape for a security control to have.
 *
 * A custom standard scheme also gives the renderer a real origin, which is what
 * makes `localStorage`, `fetch` and module scripts behave predictably.
 *
 * `app://mail` is a second, separate origin on the same scheme. The reader
 * points a sandboxed frame at it, and the body arrives with its own policy as a
 * response header, so mail HTML never shares an origin, a policy or a document
 * with the application (.claude/rules/security.md section 4).
 *
 * `app://asset` is a third, and serves one thing: the bytes of a project file
 * that is an image, for a thumbnail. It takes an asset id and resolves the path
 * itself, so the renderer never names a file. Anything that is not an image it
 * is willing to decode is a 404 rather than a download, because a response this
 * origin serves is only ever the source of an `<img>`.
 */
import { net, protocol } from "electron";
import { normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isLocked } from "./services/lock";
import { renderBody } from "./services/mail-threads";
import { frameCsp } from "./services/mail-sanitise";
import * as projectAssets from "./services/project-assets";

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

function serveBundle(root: string, url: URL): Promise<Response> {
	let pathname = decodeURIComponent(url.pathname);
	if (pathname === "" || pathname === "/") pathname = "/index.html";

	const target = normalize(resolve(root, `.${pathname}`));

	// Containment check. Without it, app://bundle/../../../etc/passwd reads
	// whatever the user account can read. Comparing with a trailing separator
	// stops "/root-evil" matching a root of "/root".
	if (target !== root && !target.startsWith(root + sep)) {
		return Promise.resolve(new Response("Forbidden", { status: 403 }));
	}

	return net.fetch(pathToFileURL(target).toString()).catch(() =>
		// A client-side router asking for a path that is not a file should get
		// the shell back, not a 404.
		net.fetch(pathToFileURL(resolve(root, "index.html")).toString()),
	);
}

function serveMail(url: URL): Response {
	// The lock guard covers IPC, not this. A locked app must not hand a body to
	// anything that asks for the URL.
	if (isLocked()) return new Response("Locked", { status: 423 });

	const match = /^\/message\/([a-z0-9-]+)$/i.exec(url.pathname);
	if (!match) return new Response("Not found", { status: 404 });

	const allowRemoteImages = url.searchParams.get("images") === "1";
	const body = renderBody(match[1]!, { allowRemoteImages });
	if (!body) return new Response("Not found", { status: 404 });

	return new Response(body.document, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy": frameCsp(allowRemoteImages),
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store",
		},
	});
}

/**
 * The image types a thumbnail may be. SVG is absent on purpose: it is a
 * document that can carry script, and serving one from an origin the renderer
 * trusts as an image source is a bigger door than a preview is worth. An SVG
 * asset gets the file placeholder and opens in the system viewer instead.
 */
const IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/bmp",
]);

async function serveAsset(url: URL): Promise<Response> {
	// Same reasoning as the mail host: the lock guard covers IPC, not a URL.
	if (isLocked()) return new Response("Locked", { status: 423 });

	const match = /^\/file\/([a-z0-9-]+)$/i.exec(url.pathname);
	if (!match) return new Response("Not found", { status: 404 });

	let file: { path: string; mimeType: string | null };
	try {
		file = projectAssets.pathOf(match[1]!);
	} catch {
		// A missing file is an ordinary state here, not an error worth a message:
		// a linked asset whose original moved is exactly this.
		return new Response("Not found", { status: 404 });
	}
	if (!file.mimeType || !IMAGE_TYPES.has(file.mimeType)) {
		return new Response("Not an image", { status: 415 });
	}

	const response = await net.fetch(pathToFileURL(file.path).toString());
	return new Response(response.body, {
		status: response.status,
		headers: {
			"Content-Type": file.mimeType,
			"Content-Security-Policy": "default-src 'none'; sandbox",
			"X-Content-Type-Options": "nosniff",
			// The bytes behind an id can be replaced by a rename, and a cached
			// thumbnail of the previous file is worse than fetching it again.
			"Cache-Control": "no-store",
		},
	});
}

/**
 * `rootDir` is the built renderer, or null in development, where the window
 * loads from the Vite server and only the mail host is needed.
 */
export function registerAppScheme(rootDir: string | null): void {
	const root = rootDir ? resolve(rootDir) : null;

	protocol.handle("app", async (request) => {
		const url = new URL(request.url);
		if (url.host === "mail") return serveMail(url);
		if (url.host === "asset") return serveAsset(url);
		if (url.host === "bundle" && root) return serveBundle(root, url);
		return new Response("Not found", { status: 404 });
	});
}
