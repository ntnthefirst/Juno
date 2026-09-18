/**
 * The mail templates that ship. Dutch (Belgium), one register each, plain
 * sentences, per .claude/rules/writing.md.
 *
 * Unlike the document templates these are not legal text, so they carry no
 * specimen flag. They are still a starting point rather than the owner's
 * voice, and the editor is where they become that.
 *
 * Placeholder syntax is in ./template-render.ts and the available paths are the
 * same as for documents (docs/templates.md), plus `document.dueOn` and
 * `document.amount`, which the composer asks for when a template uses them.
 */
import type { SeedMailTemplate } from "./mail-templates";

export const MAIL_TEMPLATE_SEED_VERSION = 1;

const SIGNOFF_U = `<p>Met vriendelijke groeten,<br>{{ owner.contactName }}{{#if owner.businessName}}<br>{{ owner.businessName }}{{/if}}</p>`;
const SIGNOFF_JE = `<p>Groeten,<br>{{ owner.contactName }}{{#if owner.businessName}}<br>{{ owner.businessName }}{{/if}}</p>`;

export const MAIL_TEMPLATES: SeedMailTemplate[] = [
	{
		key: "contract_cover",
		name: "Contract ter ondertekening",
		description: "Begeleidt een contract dat als bijlage meegaat.",
		register: "u",
		subject: "{{ document.title }} ter ondertekening",
		bodyHtml: `
<p>Beste {{ client.contactName }},</p>
<p>In bijlage vindt u {{ document.title }}. Leest u het document rustig na. Als alles klopt, mag u het ondertekend terugsturen. Als er iets moet veranderen, hoor ik het graag.</p>
${SIGNOFF_U}
`.trim(),
	},
	{
		key: "project_kickoff",
		name: "Start van een project",
		description: "De eerste mail als een project van start gaat.",
		register: "je",
		subject: "We starten met {{ project.name }}",
		bodyHtml: `
<p>Dag {{ client.contactName }},</p>
<p>Fijn dat we samen aan {{ project.name }} beginnen.{{#if project.dueOn}} De afgesproken opleverdatum is {{ project.dueOn }}.{{/if}}</p>
<p>Om goed te kunnen starten heb ik nog een paar dingen van jou nodig. Ik zet ze hieronder op een rij en laat je weten zodra er iets te bekijken valt.</p>
${SIGNOFF_JE}
`.trim(),
	},
	{
		key: "invoice_due",
		name: "Herinnering openstaande factuur",
		description: "Een vriendelijke herinnering. Bureau maakt de factuur niet, het herinnert er alleen aan.",
		register: "u",
		subject: "Herinnering: {{ document.title }}",
		bodyHtml: `
<p>Beste {{ client.contactName }},</p>
<p>Volgens mijn administratie staat {{ document.title }}{{#if document.dueOn}} met vervaldatum {{ document.dueOn }}{{/if}} nog open{{#if document.amount}}, voor een bedrag van {{ document.amount }}{{/if}}.</p>
<p>Mogelijk is de betaling al onderweg. In dat geval mag u dit bericht negeren. Anders vraag ik u het bedrag in de komende dagen over te maken.</p>
${SIGNOFF_U}
`.trim(),
	},
	{
		key: "hosting_renewal",
		name: "Verlenging hosting",
		description: "Kondigt aan dat de hosting verlengd wordt, en wat dat kost.",
		register: "u",
		subject: "Verlenging hosting {{ client.name }}",
		bodyHtml: `
<p>Beste {{ client.contactName }},</p>
<p>De hosting van uw website loopt binnenkort af{{#if document.dueOn}}, op {{ document.dueOn }}{{/if}}. Zonder tegenbericht verleng ik ze met een jaar{{#if document.amount}}, aan {{ document.amount }} per jaar{{/if}}.</p>
<p>Wilt u iets veranderen aan de hosting of aan het contract, laat het dan voor die datum weten.</p>
${SIGNOFF_U}
`.trim(),
	},
];
