/**
 * The stylesheet a document is printed with.
 *
 * Deliberately NOT the application tokens. A contract is printed on paper, in
 * ink, and has to look the same regardless of whether the person who generated
 * it runs Juno in dark mode. Fixed values are correct here and a theme token
 * would be a bug.
 *
 * Sizes are in mm and pt because that is what a printer works in.
 */
export const DOCUMENT_CSS = `
@page {
	size: A4;
	margin: 24mm 20mm 22mm 20mm;
}

html, body {
	margin: 0;
	padding: 0;
	background: #ffffff;
	color: #111111;
}

body {
	font-family: "Inter", "Segoe UI", system-ui, sans-serif;
	font-size: 10.5pt;
	line-height: 1.55;
}

h1 {
	font-size: 16pt;
	line-height: 1.25;
	margin: 0 0 2mm;
	letter-spacing: -0.01em;
}

h2 {
	font-size: 11.5pt;
	margin: 7mm 0 2mm;
	/* A clause heading orphaned at the foot of a page reads as a missing clause. */
	break-after: avoid;
	page-break-after: avoid;
}

p { margin: 0 0 2.5mm; }
ol, ul { margin: 0 0 2.5mm; padding-left: 6mm; }
li { margin: 0 0 1mm; }

.juno-doc-meta {
	font-size: 9pt;
	color: #555555;
	margin: 0 0 6mm;
}

.juno-parties {
	margin: 0 0 6mm;
}
.juno-parties dt {
	font-weight: 600;
	margin-top: 2.5mm;
}
.juno-parties dd {
	margin: 0;
}

/* A missing value has to be impossible to miss on a printed page, because a
   blank space gets signed and a marked gap gets questioned. */
.juno-missing {
	background: #ffe8e8;
	border: 0.4mm solid #b03030;
	color: #8f2020;
	padding: 0 1mm;
	font-weight: 600;
	white-space: nowrap;
}

/* The specimen banner. Printed on every page of an unreviewed template, because
   the whole risk is a made-up contract being treated as a real one. */
.juno-specimen {
	border: 0.6mm solid #b03030;
	background: #fff4f4;
	color: #8f2020;
	padding: 3mm 4mm;
	margin: 0 0 6mm;
	font-size: 9.5pt;
	font-weight: 600;
}

.juno-signatures {
	margin-top: 10mm;
	display: flex;
	gap: 12mm;
	break-inside: avoid;
	page-break-inside: avoid;
}
.juno-signature {
	flex: 1;
	border-top: 0.3mm solid #111111;
	padding-top: 2mm;
	font-size: 9.5pt;
}
.juno-signature .role { color: #555555; }

.juno-clause { break-inside: avoid; page-break-inside: avoid; }
`;

/**
 * Wraps a rendered body into a full printable document.
 *
 * The specimen banner is added here rather than stored in any template, so it
 * cannot be edited out of one by accident and appears on everything generated
 * from an unreviewed template.
 */
export function documentShell(options: {
	title: string;
	bodyHtml: string;
	isSpecimen: boolean;
	language?: string;
}): string {
	const banner = options.isSpecimen
		? `<div class="juno-specimen">VOORBEELDDOCUMENT. Deze tekst is niet juridisch nagekeken en
			mag niet als overeenkomst gebruikt of ondertekend worden.</div>`
		: "";

	return `<!doctype html>
<html lang="${options.language ?? "nl-BE"}">
<head>
<meta charset="utf-8">
<title>${options.title}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${banner}
${options.bodyHtml}
</body>
</html>`;
}
