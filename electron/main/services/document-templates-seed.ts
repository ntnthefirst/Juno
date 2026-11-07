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
 * canvas, the editor every new template is made in (decision 41): two A4
 * pages, headings, a list, a table, a signature block and fifteen inputs. A
 * canvas template reads nothing from the records, so every name, address and
 * number a contract would take from a client is an input here, typed when the
 * template is used. Dutch (Belgium), "u", per .claude/rules/writing.md. It is
 * an ordinary template afterwards, not a system row: the owner edits it or
 * deletes it, and an upgrade never brings it back (`ensureTemplatesSeeded` in
 * ./document-templates).
 *
 * It is still unreviewed, like every template `create` writes. Documents made
 * from it carry the specimen banner and cannot be signed until the owner has
 * read the text and marked it as checked. It is an example, not legal advice.
 */
import { DEFAULT_PAPER, newPage, normaliseCanvas } from "../../shared/paper";
import type {
	DocumentCanvas,
	MailBlock,
	MailColumns,
	MailColumnsCell,
	MailNode,
	TemplateInput as TemplateField,
} from "../../shared/types";
import type { TemplateInput } from "./document-templates";
import { emptyBox, newBlock } from "./mail-layout";

/**
 * 1 was the five invented templates, seeded by matching keys and never
 * recorded. 2 is the example on a first install and nothing else. The example
 * moving from the page model to the canvas does not change the number: a
 * first install is the only place it is ever written.
 */
export const DOCUMENT_TEMPLATE_SEED_VERSION = 2;

function heading(tag: "h1" | "h2" | "h3", content: string): MailBlock {
	return { ...newBlock("heading"), tag, content } as MailBlock;
}

function text(html: string, tag: "p" | "ul" = "p"): MailBlock {
	return { ...newBlock("text"), tag, html } as MailBlock;
}

const RULE = "#c8c9d4";

function cell(children: MailNode[], options: { width?: number; header?: boolean; bare?: boolean } = {}): MailColumnsCell {
	return {
		id: globalThis.crypto.randomUUID(),
		width: options.width ?? null,
		verticalAlign: "top",
		box: options.bare
			? emptyBox()
			: { ...emptyBox(), padding: { top: 6, right: 8, bottom: 6, left: 8 }, borderWidth: 1, borderColor: RULE },
		actions: [],
		children: options.header
			? children.map((node) =>
					node.kind === "text" ? ({ ...node, text: { ...node.text, weight: "semibold" } } as MailNode) : node,
				)
			: children,
	};
}

function table(name: string, rows: [string, string][]): MailColumns {
	return {
		id: globalThis.crypto.randomUUID(),
		kind: "columns",
		hidden: false,
		name,
		alignSelf: "auto",
		grow: 0,
		gap: 0,
		box: emptyBox(),
		actions: [],
		rows: rows.map(([label, value], index) => ({
			id: globalThis.crypto.randomUUID(),
			cells: [
				cell([text(label)], { width: 30, header: true }),
				cell([text(value)], { width: 70, header: index === 0 }),
			],
		})),
	};
}

/** A line to sign on, with the name of the party under it and room above for the stamp. */
function signature(party: string, name: string): MailColumnsCell {
	const line = { ...newBlock("divider"), grow: 0, color: "#16161d" } as MailBlock;
	const space = { ...newBlock("spacer"), height: 56 } as MailBlock;
	return cell([space, line, text(`<strong>${name}</strong><br>${party}`)], { bare: true });
}

function signatures(): MailColumns {
	return {
		id: globalThis.crypto.randomUUID(),
		kind: "columns",
		hidden: false,
		name: "Signatures",
		alignSelf: "auto",
		grow: 0,
		gap: 48,
		box: emptyBox(),
		actions: [],
		rows: [
			{
				id: globalThis.crypto.randomUUID(),
				cells: [
					signature("Opdrachtnemer", "{{document.owner_name}}"),
					signature("Opdrachtgever", "{{document.client_name}}"),
				],
			},
		],
	};
}

function canvas(): DocumentCanvas {
	const first = {
		...newPage(DEFAULT_PAPER, "Page 1"),
		children: [
			heading("h1", "Voorbeeldovereenkomst"),
			text("Opgemaakt te {{document.place}} op {{document.date}}."),
			text(
				"<strong>Dit is een voorbeeld om aan te passen.</strong> Het sjabloon toont wat de editor kan: " +
					"velden die bij het gebruik worden gevraagd, twee pagina's, een tabel en een plaats om te ondertekenen. " +
					"De tekst is verzonnen en niet juridisch nagekeken. Pas hem aan, of verwijder het sjabloon.",
			),
			heading("h2", "1. Partijen"),
			text(
				'<strong>Opdrachtnemer ("wij")</strong><br>{{document.owner_name}}, {{document.owner_address}}' +
					"<br>Ondernemingsnummer {{document.owner_vat}}",
			),
			text(
				'<strong>Opdrachtgever ("u")</strong><br>{{document.client_name}}, {{document.client_address}}' +
					"<br>Ondernemingsnummer {{document.client_vat}}",
			),
			heading("h2", "2. Opdracht"),
			text(
				'Wij voeren voor u de volgende opdracht uit in het kader van het project "{{document.project_name}}": ' +
					"{{document.scope}}",
			),
			text("Wat hier niet staat, valt buiten de opdracht."),
			heading("h2", "3. Uw medewerking"),
			text(
				"<li>U bezorgt ons tijdig de teksten, beelden en toegangen die nodig zijn.</li>" +
					"<li>U bundelt uw feedback per fase.</li>" +
					"<li>U wijst een aanspreekpunt aan.</li>",
				"ul",
			),
		],
	};

	const second = {
		...newPage(DEFAULT_PAPER, "Page 2"),
		children: [
			heading("h2", "4. Planning en vergoeding"),
			text("Dit spreken wij met u af."),
			table("Afspraken", [
				["Onderdeel", "Afspraak"],
				["Opdracht", "{{document.project_name}}"],
				["Start", "{{document.start}}"],
				["Oplevering", "{{document.delivery}}"],
				["Vergoeding", "{{document.fee}} exclusief btw"],
				[
					"Betaling",
					"{{document.payment_terms}}. U betaalt binnen {{document.payment_days}} dagen na factuurdatum.",
				],
			]),
			text("Werk dat buiten de opdracht valt, bespreken wij vooraf met u. Daarvoor krijgt u een aparte offerte."),
			heading("h2", "5. Toepasselijk recht"),
			text(
				"Op deze overeenkomst is het Belgisch recht van toepassing. Bij een geschil is de rechtbank van " +
					"het arrondissement waar wij gevestigd zijn bevoegd.",
			),
			heading("h3", "Voor akkoord"),
			text(
				"Opgemaakt in twee exemplaren te {{document.place}} op {{document.date}}. " +
					"Elke partij erkent een exemplaar te hebben ontvangen.",
			),
			signatures(),
		],
	};

	return normaliseCanvas({
		version: 1,
		paper: DEFAULT_PAPER,
		layout: {
			version: 2,
			width: 0,
			widthMode: "fixed",
			minHeight: 0,
			fill: null,
			fonts: [],
			customCss: null,
			children: [first, second],
			breakpoints: [],
		},
	});
}

function input(key: string, label: string, extra: Partial<TemplateField> = {}): TemplateField {
	return { key, label, kind: "text", required: true, ...extra };
}

const INPUTS: TemplateField[] = [
	input("date", "Datum", { help: "Bijvoorbeeld 14 november 2026." }),
	input("place", "Plaats van opmaak"),
	input("owner_name", "Uw bedrijfsnaam"),
	input("owner_address", "Uw adres", { help: "Straat, nummer, postcode en plaats op één regel." }),
	input("owner_vat", "Uw ondernemingsnummer"),
	input("client_name", "Naam van de klant"),
	input("client_address", "Adres van de klant", { help: "Straat, nummer, postcode en plaats op één regel." }),
	input("client_vat", "Ondernemingsnummer van de klant"),
	input("project_name", "Naam van het project"),
	input("scope", "Wat wordt er gedaan", {
		kind: "textarea",
		help: "Een of twee zinnen. Ze komen letterlijk onder Opdracht in de overeenkomst.",
	}),
	input("start", "Start", { defaultValue: "Bij ondertekening" }),
	input("delivery", "Oplevering", { defaultValue: "In overleg" }),
	input("fee", "Vergoeding", { help: "Het bedrag exclusief btw, bijvoorbeeld 2.100,00 euro." }),
	input("payment_terms", "Betaling", {
		kind: "choice",
		options: [
			"In één keer bij oplevering",
			"In twee schijven: de helft bij ondertekening, de helft bij oplevering",
		],
		defaultValue: "In één keer bij oplevering",
	}),
	input("payment_days", "Betalingstermijn in dagen", {
		kind: "number",
		required: false,
		help: "Het aantal dagen na de factuurdatum.",
		defaultValue: "14",
	}),
];

export function exampleTemplate(): TemplateInput {
	return {
		key: "voorbeeld_overeenkomst",
		name: "Voorbeeld: overeenkomst met alle onderdelen",
		description:
			"Toont wat de editor kan: velden die bij het gebruik worden gevraagd, twee pagina's, een tabel en een plaats om te ondertekenen. Pas het aan of verwijder het.",
		language: "nl-BE",
		canvas: canvas(),
		inputs: INPUTS,
	};
}
