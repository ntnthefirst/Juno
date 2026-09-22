/**
 * The development server, described once.
 *
 * The port lived in three places (the Vite config, the window's content policy
 * and the wait-on in package.json) and the nonce has to match exactly across
 * two of them, so both are defined here and imported by the Vite config and by
 * the main process.
 */

export const DEV_PORT = 5173;
export const DEV_URL = `http://localhost:${DEV_PORT}`;
export const DEV_WS_URL = `ws://localhost:${DEV_PORT}`;

/**
 * Why a nonce at all: `@vitejs/plugin-react` injects its refresh preamble as an
 * **inline** module script, and the renderer runs under `script-src 'self'`, so
 * the browser blocks it. The preamble never runs, every module the plugin
 * transformed then throws on `$RefreshReg$`, and the window paints white with
 * the reason only in the renderer console.
 *
 * The alternative is `'unsafe-inline'` in development, which would mean the one
 * build nobody can look at is the one that enforces the real policy. A nonce
 * keeps the directive the shape it ships as, and admits exactly the tags Vite
 * stamped rather than any inline script at all.
 *
 * It is fixed rather than per-response because the header is set by the main
 * process and the HTML is written by a separate Vite process, which cannot
 * agree on a fresh value per request. That is fine here and nowhere else: this
 * value never reaches a packaged build, where the CSP carries no nonce and no
 * inline script exists to need one.
 */
export const DEV_CSP_NONCE = "juno-dev-refresh-preamble";
