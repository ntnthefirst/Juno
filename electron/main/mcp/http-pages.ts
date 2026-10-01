/**
 * The two pages the listener serves to a browser: the one that shows the code,
 * and the one that says why nothing happened.
 *
 * Plain HTML with no external anything, styled with the browser's own system
 * colours so it follows light and dark without carrying a palette of its own.
 * Every value that came from a client is escaped, because the client chose it.
 */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const STYLE = `
	:root { color-scheme: light dark; }
	* { box-sizing: border-box; }
	body {
		margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
		font: 15px/1.5 system-ui, "Segoe UI", sans-serif; background: Canvas; color: CanvasText;
	}
	main { width: min(440px, 100% - 32px); padding: 32px 0; }
	h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
	p { margin: 8px 0; color: GrayText; }
	.who { color: CanvasText; font-weight: 600; }
	.code {
		margin: 24px 0 8px; padding: 18px 12px; border: 1px solid GrayText; border-radius: 12px;
		font: 600 40px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: 0.14em;
		text-align: center; font-variant-numeric: tabular-nums; color: CanvasText;
	}
	.status { margin-top: 20px; min-height: 1.5em; }
	.warn { margin-top: 20px; font-size: 13px; }
`;

export function renderPairingPage(input: { clientName: string; code: string; pairingId: string; nonce: string }): string {
	const digits = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Juno</title>
<style>${STYLE}</style>
</head>
<body>
<main>
	<h1>Connect to Juno</h1>
	<p><span class="who">${escapeHtml(input.clientName)}</span> wants to use Juno on this computer.</p>
	<p>Type this code into the Juno window to allow it.</p>
	<div class="code" aria-label="Code">${digits}</div>
	<p class="status" id="status" role="status">Waiting for you to type it in Juno.</p>
	<p class="warn">If you did not just connect an app yourself, close this page and press Deny in Juno.</p>
</main>
<script nonce="${input.nonce}">
(function () {
	var id = ${JSON.stringify(input.pairingId)};
	var status = document.getElementById("status");
	function poll() {
		fetch("/authorize/status?id=" + encodeURIComponent(id), { cache: "no-store" })
			.then(function (response) { return response.json(); })
			.then(function (state) {
				if (state.status === "waiting") { setTimeout(poll, 1000); return; }
				if (state.status === "done") {
					status.textContent = state.denied ? "Juno said no. You can close this page." : "Allowed. Going back to the app.";
					window.location.replace(state.redirect);
					return;
				}
				status.textContent = "This request is no longer open. Start it again from the app.";
			})
			.catch(function () { setTimeout(poll, 2000); });
	}
	poll();
})();
</script>
</body>
</html>
`;
}

export function renderMessagePage(title: string, message: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
	<h1>${escapeHtml(title)}</h1>
	<p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`;
}
