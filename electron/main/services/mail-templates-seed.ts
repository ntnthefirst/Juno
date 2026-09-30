/**
 * The one mail template that ships, and only on a first install.
 *
 * Juno used to seed four hand-written templates (contract_cover,
 * project_kickoff, invoice_due, hosting_renewal). They are gone from the code:
 * an install that already has them keeps its rows exactly as they are, since
 * nothing seeds, updates, hides or removes them any more, and a new install
 * never gets them. Nothing may look one up by key, because most installs will
 * not have it.
 *
 * What a new install gets in their place is a single example laid out on the
 * canvas, so opening it teaches the editor. Dutch (Belgium), "u", per
 * .claude/rules/writing.md. It is an ordinary template afterwards, not a system
 * row: the owner edits it or deletes it, and a reset or an upgrade never
 * brings it back (`ensureMailTemplatesSeeded` in ./mail-templates).
 *
 * Placeholder syntax is in ./template-render.ts and the available paths are
 * the ones in docs/templates.md. Conditionals do not nest, so each optional
 * line of the footer has its own.
 */
import type {
	MailAction,
	MailBlock,
	MailBoxStyle,
	MailBreakpoint,
	MailColumns,
	MailColumnsCell,
	MailContainer,
	MailLayout,
	MailNode,
	MailSectionLayout,
	MailSpacing,
	MailTemplateInput,
	MailTextStyle,
	TemplateInput,
} from "../../shared/types";
import { defaultText, emptyBox, solidFill } from "./mail-layout";

/**
 * 1 was the four shipped templates, seeded by matching keys and never
 * recorded. 2 is the example on a first install and nothing else.
 */
export const MAIL_TEMPLATE_SEED_VERSION = 2;

const INK = "#16161d";
const INK_MUTED = "#5d5e70";
const LINE = "#e3e2ec";
const ACCENT = "#4a3fa0";
const ACCENT_DEEP = "#3a3180";
const ACCENT_LIGHT = "#7a6ee0";
const PAPER = "#f6f6fa";
const WASH = "#efedfb";
const WHITE = "#ffffff";

function spacing(top: number, right: number, bottom: number, left: number): MailSpacing {
	return { top, right, bottom, left };
}

function box(patch: Partial<MailBoxStyle> = {}): MailBoxStyle {
	return { ...emptyBox(), ...patch };
}

function typeStyle(patch: Partial<MailTextStyle> = {}): MailTextStyle {
	return { ...defaultText(), ...patch };
}

function column(gap: number, align: "start" | "center" | "end" | "stretch" = "stretch", justify: "start" | "center" | "end" = "start"): MailSectionLayout {
	return { kind: "flex", direction: "column", justify, align, gap, wrap: false };
}

function paragraph(
	id: string,
	html: string,
	options: {
		text?: Partial<MailTextStyle>;
		box?: Partial<MailBoxStyle>;
		alignSelf?: MailBlock["alignSelf"];
		actions?: MailAction[];
	} = {},
): MailBlock {
	return {
		id,
		grow: 0,
		alignSelf: options.alignSelf ?? "auto",
		hidden: false,
		actions: options.actions ?? [],
		kind: "text",
		tag: "p",
		html,
		text: typeStyle(options.text),
		box: box(options.box),
	};
}

function heading(id: string, tag: "h1" | "h3", content: string, text: Partial<MailTextStyle>): MailBlock {
	return {
		id,
		grow: 0,
		alignSelf: "auto",
		hidden: false,
		actions: [],
		kind: "heading",
		tag,
		content,
		text: typeStyle({ weight: "semibold", ...text }),
		box: box(),
	};
}

function container(
	id: string,
	tag: MailContainer["tag"],
	name: string,
	layout: MailSectionLayout,
	style: Partial<MailBoxStyle>,
	children: MailNode[],
	grow = 0,
): MailContainer {
	return { id, kind: "container", tag, hidden: false, name, alignSelf: "auto", grow, layout, box: box(style), actions: [], children };
}

/** One cell of the comparison: a single line of text in a bordered cell. */
function cell(id: string, width: number, words: string, header: boolean): MailColumnsCell {
	return {
		id,
		width,
		verticalAlign: "middle",
		box: box({
			fill: header ? solidFill(PAPER) : null,
			padding: spacing(8, 10, 8, 10),
			borderWidth: 1,
			borderColor: LINE,
			borderSides: { top: false, right: false, bottom: true, left: false },
		}),
		actions: [],
		children: [
			paragraph(`${id}-tekst`, words, { text: { fontSize: 13, weight: header ? "semibold" : "normal", color: INK } }),
		],
	};
}

function comparison(): MailColumns {
	const rows: [string, string, string, boolean][] = [
		["Hosting", "Basis", "Uitgebreid", true],
		["Opslag", "10 GB", "50 GB", false],
		["Back-ups", "Wekelijks", "Dagelijks", false],
	];
	return {
		id: "voorbeeld-vergelijking",
		kind: "columns",
		hidden: false,
		name: "Vergelijking",
		alignSelf: "auto",
		grow: 0,
		gap: 0,
		box: box(),
		actions: [],
		rows: rows.map(([first, second, third, header], index) => ({
			id: `voorbeeld-rij-${index + 1}`,
			cells: [
				cell(`voorbeeld-cel-${index + 1}-1`, 40, first, header),
				cell(`voorbeeld-cel-${index + 1}-2`, 30, second, header),
				cell(`voorbeeld-cel-${index + 1}-3`, 30, third, header),
			],
		})),
	};
}

/**
 * The two boxes that sit side by side. Each takes an equal share of the row
 * and holds a heading and a line; at the phone width the row runs down instead.
 */
function duo(): MailContainer {
	const half = (id: string, title: string, words: string) =>
		container(
			id,
			"div",
			title,
			column(6),
			{ fill: solidFill(PAPER), padding: spacing(16, 16, 16, 16), borderRadius: 8 },
			[
				heading(`${id}-titel`, "h3", title, { fontSize: 15, color: INK }),
				paragraph(`${id}-tekst`, words, { text: { fontSize: 14, color: INK_MUTED } }),
			],
			1,
		);
	return container(
		"voorbeeld-duo",
		"div",
		"Twee kolommen",
		{ kind: "flex", direction: "row", justify: "start", align: "stretch", gap: 16, wrap: false },
		{},
		[
			half("voorbeeld-links", "Wat ik doe", "Ik bouw en onderhoud uw website."),
			half("voorbeeld-rechts", "Wat u doet", "U levert de teksten en de afbeeldingen aan."),
		],
	);
}

function content(): MailContainer {
	return container(
		"voorbeeld-inhoud",
		"main",
		"Inhoud",
		column(16),
		{
			fill: solidFill(WHITE),
			padding: spacing(28, 28, 28, 28),
			margin: spacing(24, 24, 24, 24),
			borderWidth: 1,
			// A colour with an opacity of its own: the two digits after the six.
			borderColor: "#4a3fa040",
			borderRadius: 12,
			effects: [{ kind: "shadow", inset: false, x: 0, y: 4, blur: 16, spread: 0, color: INK, opacity: 0.12, hidden: false }],
		},
		[
			paragraph(
				"voorbeeld-opmerking",
				"Dit is een voorbeeld dat laat zien wat de editor kan. Pas het aan voordat u het naar iemand stuurt.",
				{
					text: { fontSize: 14, color: INK },
					box: {
						fill: solidFill(WASH),
						padding: spacing(12, 16, 12, 16),
						borderRadius: 6,
						borderWidth: 3,
						borderColor: ACCENT,
						borderSides: { top: false, right: false, bottom: false, left: true },
					},
				},
			),
			paragraph(
				"voorbeeld-tekst",
				'Beste {{ client.contactName }},<br><br>Bedankt voor het fijne gesprek. Hieronder vindt u <strong>wat we afspraken</strong> en wat ik <em>nog van u nodig heb</em>. Meer uitleg vindt u op <a href="https://www.example.com/werkwijze">mijn website</a>.',
				{ text: { color: INK } },
			),
			{
				id: "voorbeeld-foto",
				grow: 0,
				alignSelf: "start",
				hidden: false,
				actions: [],
				kind: "field",
				inputKey: "foto",
				text: typeStyle(),
				box: box({ width: 240, borderRadius: 8 }),
			},
			duo(),
			comparison(),
			paragraph("voorbeeld-knop", "Bekijk het voorstel", {
				alignSelf: "start",
				text: { weight: "semibold", align: "center", color: WHITE },
				box: { fill: solidFill(ACCENT), padding: spacing(12, 22, 12, 22), borderRadius: 6 },
				actions: [
					{ id: "voorbeeld-klik", trigger: "click", kind: "link", target: "www.example.com/voorstel", hidden: false },
					{ id: "voorbeeld-hover", trigger: "hover", change: "fill", fill: solidFill(ACCENT_DEEP), hidden: false },
				],
			}),
			// An empty section with a height and a stroke on one side is a divider.
			container(
				"voorbeeld-lijn",
				"section",
				"Scheidingslijn",
				column(0),
				{
					minHeight: 16,
					borderWidth: 1,
					borderColor: LINE,
					borderSides: { top: false, right: false, bottom: true, left: false },
				},
				[],
			),
			{
				id: "voorbeeld-code",
				grow: 0,
				alignSelf: "auto",
				hidden: false,
				actions: [],
				kind: "html",
				html: `<p style="margin:0;font-family:Courier New,Courier,monospace;font-size:14px;line-height:1.5;color:${INK}">Uw referentie: <strong>VOORBEELD-001</strong></p>`,
				css: `background-color:${PAPER};border-radius:6px;padding:12px 16px`,
			},
			paragraph("voorbeeld-groet", "Met vriendelijke groeten,<br>{{ owner.contactName }}", { text: { color: INK } }),
		],
	);
}

/** The business details, which a canvas no longer gets from a frame (decision 37). */
function footer(): MailContainer {
	return container(
		"voorbeeld-voet",
		"footer",
		"Voettekst",
		column(4, "center", "center"),
		{ padding: spacing(8, 32, 32, 32) },
		[
			paragraph(
				"voorbeeld-gegevens",
				"<strong>{{ owner.businessName }}</strong><br>{{ owner.contactName }}" +
					"{{#if owner.addressLine1}}<br>{{ owner.addressLine1 }}, {{ owner.postalCode }} {{ owner.city }}{{/if}}" +
					"{{#if owner.vatNumber}}<br>Ondernemingsnummer {{ owner.vatNumber }}{{/if}}",
				{ text: { fontSize: 12, lineHeight: 1.5, color: INK_MUTED, align: "center" } },
			),
		],
	);
}

/** Narrow screens: the two boxes run down, and the card gives up some of its room. */
const PHONE: MailBreakpoint = {
	id: "voorbeeld-telefoon",
	name: "Phone",
	maxWidth: 480,
	sections: {
		"voorbeeld-duo": { layout: { kind: "flex", direction: "column", justify: "start", align: "stretch", gap: 12, wrap: false } },
		"voorbeeld-inhoud": { box: { padding: spacing(20, 16, 20, 16), margin: spacing(12, 12, 12, 12) } },
	},
	blocks: {},
};

export function exampleLayout(): MailLayout {
	return {
		version: 2,
		width: 600,
		widthMode: "fixed",
		minHeight: 320,
		fill: solidFill(PAPER),
		fonts: [{ family: "Poppins", source: "google", href: null, weights: [400, 600], italic: false, fallback: "sans" }],
		customCss: null,
		children: [
			container(
				"voorbeeld-kop",
				"header",
				"Kop",
				{ kind: "flex", direction: "row", justify: "start", align: "center", gap: 20, wrap: false },
				{
					fill: { kind: "gradient", angle: 135, from: ACCENT, to: ACCENT_LIGHT, hidden: false },
					padding: spacing(24, 32, 24, 32),
				},
				[
					{
						id: "voorbeeld-logo",
						grow: 0,
						alignSelf: "auto",
						hidden: false,
						actions: [],
						kind: "image",
						src: "https://www.example.com/logo.png",
						alt: "Logo van uw bedrijf",
						width: 96,
						align: "left",
						box: box(),
					},
					heading("voorbeeld-titel", "h1", "Voorbeeldbericht", { fontFamily: "Poppins", fontSize: 24, lineHeight: 1.2, color: WHITE }),
				],
			),
			content(),
			footer(),
		],
		breakpoints: [PHONE],
	};
}

export const EXAMPLE_INPUTS: TemplateInput[] = [
	{
		key: "foto",
		label: "Foto",
		kind: "image",
		required: true,
		help: "Het https-adres van de foto in het bericht.",
		defaultValue: "https://www.example.com/foto.jpg",
	},
];

export function exampleTemplate(): MailTemplateInput {
	return {
		key: "voorbeeld",
		name: "Voorbeeld met alle onderdelen",
		description: "Laat zien wat de editor kan. Pas het aan of verwijder het.",
		register: "u",
		subject: "Voorbeeld: bericht voor {{ client.name }}",
		// The canvas is the source, so this is only what the service requires
		// before it compiles the layout over it.
		bodyHtml: "<p></p>",
		inputs: EXAMPLE_INPUTS,
		layout: exampleLayout(),
	};
}
