/**
 * The one document template that ships, and only on a first install.
 *
 * Juno used to seed five contract templates (nda, development_agreement,
 * hosting_agreement, project_scope, addendum). All five were invented so the
 * generation, preview, PDF and signing machinery had something contract-shaped
 * to work on, and none of them was checked by anyone. They are gone from the
 * code: an install that already has them keeps its rows exactly as they are,
 * since nothing seeds, updates, hides or removes them any more, and a new
 * install never gets them. Nothing may look one up by key, because most
 * installs will not have it.
 *
 * What a new install gets in their place is a single example laid out on the
 * page editor's model, so opening it teaches the editor: two pages, headings,
 * a list, a table, a block pinned to the paper, the signature blocks, every
 * kind of placeholder a layout can carry and three values the template asks
 * for when it is used. Dutch (Belgium), "u", per .claude/rules/writing.md. It
 * is an ordinary template afterwards, not a system row: the owner edits it or
 * deletes it, and an upgrade never brings it back (`ensureTemplatesSeeded` in
 * ./document-templates).
 *
 * It is still unreviewed, like every template `create` writes. Documents made
 * from it carry the specimen banner and cannot be signed until the owner has
 * read the text and marked it as checked.
 *
 * Placeholder syntax is in ./template-render.ts and the available paths are
 * documented in docs/templates.md. Two limits of that syntax shape the text
 * below. Conditionals do not nest, so each optional piece has its own. And the
 * raw form `{{& path }}` is left out on purpose: a layout escapes an ampersand
 * on its way into the page, so the marker would never be recognised.
 */
import type {
	DocumentLayout,
	LayoutBlock,
	LayoutBox,
	LayoutPage,
	TemplateInput as TemplateField,
} from "../../shared/types";
import { DEFAULT_MARGIN } from "./document-layout";
import type { TemplateInput } from "./document-templates";

/**
 * 1 was the five invented templates, seeded by matching keys and never
 * recorded. 2 is the example on a first install and nothing else.
 */
export const DOCUMENT_TEMPLATE_SEED_VERSION = 2;

function heading(id: string, level: 1 | 2 | 3, text: string): LayoutBlock {
	return { id, kind: "heading", level, text, align: "left" };
}

function paragraph(id: string, html: string): LayoutBlock {
	return { id, kind: "paragraph", html, align: "left" };
}

function page(id: string, blocks: LayoutBlock[], boxes: LayoutBox[] = []): LayoutPage {
	return { id, blocks, boxes };
}

const CLIENT_ADDRESS = [
	"<strong>{{ client.name }}</strong>",
	"{{#if client.addressLine1}}<br>{{ client.addressLine1 }}{{/if}}",
	"{{#if client.city}}<br>{{ client.postalCode }} {{ client.city }}{{/if}}",
].join("");

const OWNER_PARTY = [
	'<strong>Opdrachtnemer ("wij")</strong>',
	"<br>{{ owner.businessName }}, {{ owner.addressLine1 }}, {{ owner.postalCode }} {{ owner.city }}",
	"{{#if owner.vatNumber}}<br>Ondernemingsnummer {{ owner.vatNumber }}{{/if}}",
	"{{#if owner.email}}<br>{{ owner.email }}{{/if}}",
].join("");

const CLIENT_PARTY = [
	'<strong>Opdrachtgever ("u")</strong>',
	"<br>{{ client.name }}",
	"{{#if client.addressLine1}}, {{ client.addressLine1 }}{{/if}}",
	"{{#if client.city}}, {{ client.postalCode }} {{ client.city }}{{/if}}",
	"{{#if client.vatNumber}}<br>Ondernemingsnummer {{ client.vatNumber }}{{/if}}",
	"{{#if client.email}}<br>{{ client.email }}{{/if}}",
].join("");

/** A cell that says what the project holds, or what happens when there is none. */
function orElse(path: string, fallback: string, suffix = ""): string {
	return `{{#if ${path}}}{{ ${path} }}${suffix}{{/if}}{{#unless ${path}}}${fallback}{{/unless}}`;
}

function layout(): DocumentLayout {
	const first = page(
		"voorbeeld-pagina-1",
		[
			heading("v1-titel", 1, "Voorbeeldovereenkomst"),
			paragraph("v1-datum", "Opgemaakt te {{ owner.city }} op {{ document.issuedOn }}."),
			// Clears the address block pinned to the right of the title, so the
			// text below starts under it instead of running through it.
			{ id: "v1-ruimte", kind: "spacer", heightMm: 18 },
			paragraph(
				"v1-toelichting",
				"<strong>Dit is een voorbeeld om aan te passen.</strong> Het sjabloon laat zien wat de editor kan: " +
					"gegevens die vanzelf worden ingevuld, velden die bij het gebruik worden gevraagd, twee pagina's, " +
					"een tabel en een handtekeningblok. De tekst is verzonnen en niet juridisch nagekeken. " +
					"Pas hem aan, of verwijder het sjabloon.",
			),
			heading("v1-partijen", 2, "1. Partijen"),
			paragraph("v1-nemer", OWNER_PARTY),
			paragraph("v1-gever", CLIENT_PARTY),
			paragraph(
				"v1-woorden",
				'In deze overeenkomst is "wij" de opdrachtnemer en "u" de opdrachtgever.',
			),
			heading("v1-opdracht", 2, "2. Opdracht"),
			paragraph(
				"v1-omschrijving",
				'Wij voeren voor u de volgende opdracht uit{{#if project.name}} in het kader van het project "{{ project.name }}"{{/if}}: ' +
					"{{ document.scope }}",
			),
			paragraph(
				"v1-achtergrond",
				"{{#if project.description}}Over het project: {{ project.description }}{{/if}}" +
					"{{#unless project.description}}Wat hier niet staat, valt buiten de opdracht.{{/unless}}",
			),
			heading("v1-medewerking", 2, "3. Uw medewerking"),
			{
				id: "v1-lijst",
				kind: "list",
				ordered: false,
				items: [
					"U bezorgt ons tijdig de teksten, beelden en toegangen die nodig zijn.",
					"U bundelt uw feedback per fase.",
					"U wijst een aanspreekpunt aan{{#if client.contactName}}, voorlopig {{ client.contactName }}{{/if}}.",
				],
			},
		],
		[
			{
				id: "v1-adres",
				xMm: 130,
				yMm: 24,
				widthMm: 60,
				block: paragraph("v1-adres-blok", CLIENT_ADDRESS),
			},
		],
	);

	const second = page(
		"voorbeeld-pagina-2",
		[
			heading("v2-afspraken", 2, "4. Planning en vergoeding"),
			paragraph("v2-inleiding", "Dit spreken wij met u af."),
			{
				id: "v2-tabel",
				kind: "table",
				headerRow: true,
				columns: [
					{ header: "Onderdeel", widthPct: 30 },
					{ header: "Afspraak", widthPct: 70 },
				],
				rows: [
					["Opdracht", orElse("project.name", "Zoals omschreven onder punt 2")],
					["Start", orElse("project.startsOn", "Bij ondertekening")],
					["Oplevering", orElse("project.dueOn", "In overleg")],
					["Vergoeding", orElse("project.agreedValue", "Vooraf schriftelijk overeengekomen", " exclusief btw")],
					[
						"Betaling",
						"{{ document.payment_terms }}. U betaalt binnen {{ document.payment_days }} dagen na factuurdatum.",
					],
				],
			},
			{ id: "v2-ruimte", kind: "spacer", heightMm: 4 },
			paragraph(
				"v2-meerwerk",
				"Werk dat buiten de opdracht valt, bespreken wij vooraf met u. Daarvoor krijgt u een aparte offerte.",
			),
			heading("v2-recht", 2, "5. Toepasselijk recht"),
			paragraph(
				"v2-recht-tekst",
				"Op deze overeenkomst is het Belgisch recht van toepassing. Bij een geschil is de rechtbank van " +
					"het arrondissement waar wij gevestigd zijn bevoegd.",
			),
			{ id: "v2-lijn", kind: "divider" },
			heading("v2-akkoord", 3, "Voor akkoord"),
			paragraph(
				"v2-exemplaren",
				"Opgemaakt in twee exemplaren te {{ owner.city }} op {{ document.issuedOn }}. Elke partij erkent een exemplaar te hebben ontvangen.",
			),
		],
		// Pinned to the paper rather than flowed, so the two lines sit side by
		// side at the foot of the page whatever the text above them does.
		[
			{
				id: "v2-teken-nemer",
				xMm: 20,
				yMm: 236,
				widthMm: 75,
				block: {
					id: "v2-teken-nemer-blok",
					kind: "signature",
					label: "{{ owner.contactName }}, voor {{ owner.businessName }}",
					widthMm: 75,
				},
			},
			{
				id: "v2-teken-gever",
				xMm: 115,
				yMm: 236,
				widthMm: 75,
				block: {
					id: "v2-teken-gever-blok",
					kind: "signature",
					label: "{{#if client.contactName}}{{ client.contactName }}, {{/if}}voor {{ client.name }}",
					widthMm: 75,
				},
			},
		],
	);

	return { version: 1, pageSize: "A4", margin: { ...DEFAULT_MARGIN }, pages: [first, second] };
}

const INPUTS: TemplateField[] = [
	{
		key: "scope",
		label: "Wat wordt er gedaan",
		kind: "textarea",
		required: true,
		help: "Een of twee zinnen. Ze komen letterlijk onder Opdracht in de overeenkomst.",
	},
	{
		key: "payment_terms",
		label: "Betaling",
		kind: "choice",
		required: true,
		options: [
			"In één keer bij oplevering",
			"In twee schijven: de helft bij ondertekening, de helft bij oplevering",
		],
		defaultValue: "In één keer bij oplevering",
	},
	{
		key: "payment_days",
		label: "Betalingstermijn in dagen",
		kind: "number",
		required: false,
		help: "Het aantal dagen na de factuurdatum.",
		defaultValue: "14",
	},
];

export function exampleTemplate(): TemplateInput {
	return {
		key: "voorbeeld_overeenkomst",
		name: "Voorbeeld: overeenkomst met alle onderdelen",
		description:
			"Toont wat de editor kan: gegevens die vanzelf worden ingevuld, velden die bij het gebruik worden gevraagd, twee pagina's, een tabel en een handtekeningblok. Pas het aan of verwijder het.",
		language: "nl-BE",
		layout: layout(),
		inputs: INPUTS,
	};
}
