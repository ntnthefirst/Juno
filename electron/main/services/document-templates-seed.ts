/**
 * The document templates that ship.
 *
 * **Every one of these is invented.** They exist so the generation, preview,
 * PDF and signing machinery can be built and tested against something shaped
 * like a real contract. They are not legal advice, they have not been checked by
 * anyone, and they are not fit to send to a client.
 *
 * That is enforced rather than just written down: each one seeds with
 * `reviewedAt: null`, which makes every document generated from it carry
 * `isSpecimen`, which prints the banner from document-style.ts on the page and
 * blocks the signing screen. See TODO.md item 2.
 *
 * Replacing the text is the owner's job. When a body has been rewritten and
 * checked, clear the specimen flag on that template and only then.
 *
 * Placeholder syntax is in ./template-render.ts. Available paths are documented
 * in docs/templates.md.
 */
import type { SeedTemplate } from "./document-templates";

export const DOCUMENT_TEMPLATE_SEED_VERSION = 1;

const PARTIES = `
<dl class="bureau-parties">
	<dt>Opdrachtnemer</dt>
	<dd>
		{{ owner.businessName }}, {{ owner.addressLine1 }}, {{ owner.postalCode }} {{ owner.city }}
		{{#if owner.vatNumber}}<br>Ondernemingsnummer {{ owner.vatNumber }}{{/if}}
		{{#if owner.email}}<br>{{ owner.email }}{{/if}}
	</dd>
	<dt>Opdrachtgever</dt>
	<dd>
		{{ client.name }}{{#if client.addressLine1}}, {{ client.addressLine1 }}{{/if}}{{#if client.city}}, {{ client.postalCode }} {{ client.city }}{{/if}}
		{{#if client.vatNumber}}<br>Ondernemingsnummer {{ client.vatNumber }}{{/if}}
		{{#if client.email}}<br>{{ client.email }}{{/if}}
	</dd>
</dl>
`.trim();

const SIGNATURES = `
<div class="bureau-signatures">
	<div class="bureau-signature">
		{{ owner.contactName }}<br>
		<span class="role">voor {{ owner.businessName }}</span>
	</div>
	<div class="bureau-signature">
		{{#if client.contactName}}{{ client.contactName }}{{/if}}<br>
		<span class="role">voor {{ client.name }}</span>
	</div>
</div>
`.trim();

const META = `<p class="bureau-doc-meta">Opgemaakt te {{ owner.city }} op {{ document.issuedOn }}.</p>`;

export const DOCUMENT_TEMPLATES: SeedTemplate[] = [
	{
		key: "nda",
		name: "Geheimhoudingsovereenkomst",
		description:
			"Wederzijdse geheimhouding rond een voorlopig ontwerp of een offerte. Voorbeeldtekst.",
		bodyHtml: `
<h1>Geheimhoudingsovereenkomst</h1>
${META}
${PARTIES}

<p>Partijen wensen informatie uit te wisselen met het oog op
{{#if project.name}}het project "{{ project.name }}"{{/if}}{{#unless project.name}}een mogelijke samenwerking{{/unless}},
en komen daarom het volgende overeen.</p>

<h2 class="bureau-clause">1. Vertrouwelijke informatie</h2>
<p>Onder vertrouwelijke informatie wordt verstaan alle informatie die een partij
aan de andere partij bezorgt in het kader van deze besprekingen, met inbegrip van
ontwerpen, broncode, prijzen, klantgegevens en bedrijfsprocessen, ongeacht de
vorm waarin zij wordt meegedeeld.</p>

<h2 class="bureau-clause">2. Verplichtingen</h2>
<p>De ontvangende partij gebruikt de vertrouwelijke informatie uitsluitend voor
de hierboven omschreven doeleinden, deelt haar niet met derden zonder
voorafgaande schriftelijke toestemming, en beschermt haar met dezelfde zorg als
haar eigen vertrouwelijke informatie.</p>

<h2 class="bureau-clause">3. Uitzonderingen</h2>
<p>Deze overeenkomst geldt niet voor informatie die reeds publiek is, die de
ontvangende partij rechtmatig van een derde heeft verkregen, of waarvan
openbaarmaking wettelijk verplicht is.</p>

<h2 class="bureau-clause">4. Voorlopige ontwerpen</h2>
<p>Een voorlopig ontwerp blijft eigendom van de opdrachtnemer tot het volledige
overeengekomen bedrag is voldaan. Het mag niet worden gebruikt, gekopieerd of
aan derden bezorgd zolang geen ontwikkelovereenkomst is gesloten.</p>

<h2 class="bureau-clause">5. Duur</h2>
<p>Deze overeenkomst treedt in werking op {{ document.issuedOn }} en blijft
gelden gedurende drie jaar, ook indien de besprekingen niet tot een samenwerking
leiden.</p>

<h2 class="bureau-clause">6. Toepasselijk recht</h2>
<p>Op deze overeenkomst is het Belgisch recht van toepassing. Geschillen worden
voorgelegd aan de bevoegde rechtbanken van het arrondissement van de
opdrachtnemer.</p>

${SIGNATURES}
`.trim(),
	},

	{
		key: "development_agreement",
		name: "Ontwikkelovereenkomst",
		description: "Opdracht tot ontwikkeling van een website of webapplicatie. Voorbeeldtekst.",
		bodyHtml: `
<h1>Ontwikkelovereenkomst</h1>
${META}
${PARTIES}

<h2 class="bureau-clause">1. Voorwerp</h2>
<p>De opdrachtnemer ontwikkelt voor de opdrachtgever
{{#if project.name}}"{{ project.name }}"{{/if}}{{#unless project.name}}de overeengekomen toepassing{{/unless}},
zoals omschreven in de bijgevoegde scope-definitie. Die definitie maakt integraal
deel uit van deze overeenkomst.</p>

<h2 class="bureau-clause">2. Prijs</h2>
<p>De overeengekomen prijs bedraagt {{ project.agreedValue }} exclusief btw.
Meerwerk buiten de scope wordt vooraf besproken en apart geoffreerd.</p>

<h2 class="bureau-clause">3. Betaling</h2>
<p>Facturatie gebeurt in drie schijven: dertig procent bij ondertekening, dertig
procent bij oplevering van de testomgeving en veertig procent bij ingebruikname.
Facturen zijn betaalbaar binnen veertien dagen na factuurdatum.</p>

<h2 class="bureau-clause">4. Planning</h2>
<p>{{#if project.startsOn}}De werkzaamheden starten op {{ project.startsOn }}.{{/if}}
{{#if project.dueOn}}De streefdatum voor oplevering is {{ project.dueOn }}.{{/if}}
Een planning is een inspanningsverbintenis; vertraging door laattijdige
aanlevering van materiaal of feedback verschuift de streefdatum navenant.</p>

<h2 class="bureau-clause">5. Medewerking van de opdrachtgever</h2>
<p>De opdrachtgever levert tijdig teksten, beeldmateriaal, toegangen en feedback
aan. De opdrachtnemer is niet aansprakelijk voor vertraging die hieruit
voortvloeit.</p>

<h2 class="bureau-clause">6. Intellectuele eigendom</h2>
<p>Na volledige betaling verkrijgt de opdrachtgever een niet-exclusief,
overdraagbaar gebruiksrecht op het opgeleverde werk. De opdrachtnemer behoudt het
recht om generieke componenten en onderliggende technieken te hergebruiken.</p>

<h2 class="bureau-clause">7. Oplevering en aanvaarding</h2>
<p>De opdrachtgever beschikt over veertien dagen na oplevering om gebreken
schriftelijk te melden. Bij gebreke daarvan wordt het werk geacht aanvaard te
zijn.</p>

<h2 class="bureau-clause">8. Aansprakelijkheid</h2>
<p>De aansprakelijkheid van de opdrachtnemer is beperkt tot het bedrag van deze
overeenkomst. Indirecte schade, waaronder winstderving en gegevensverlies, komt
niet voor vergoeding in aanmerking.</p>

<h2 class="bureau-clause">9. Toepasselijk recht</h2>
<p>Op deze overeenkomst is het Belgisch recht van toepassing.</p>

${SIGNATURES}
`.trim(),
	},

	{
		key: "hosting_agreement",
		name: "Hosting- en serviceovereenkomst",
		description: "Doorlopende hosting, onderhoud en ondersteuning. Voorbeeldtekst.",
		bodyHtml: `
<h1>Hosting- en serviceovereenkomst</h1>
${META}
${PARTIES}

<h2 class="bureau-clause">1. Dienstverlening</h2>
<p>De opdrachtnemer voorziet hosting, back-ups en onderhoud voor
{{#if project.name}}"{{ project.name }}"{{/if}}{{#unless project.name}}de toepassing van de opdrachtgever{{/unless}}.
De infrastructuur bevindt zich binnen de Europese Unie.</p>

<h2 class="bureau-clause">2. Beschikbaarheid</h2>
<p>De opdrachtnemer streeft een beschikbaarheid van 99,5 procent op maandbasis
na, gepland onderhoud niet meegerekend. Gepland onderhoud wordt minstens
achtenveertig uur vooraf aangekondigd.</p>

<h2 class="bureau-clause">3. Back-ups</h2>
<p>Er wordt dagelijks een back-up genomen met een bewaartermijn van dertig dagen.
Herstel van een back-up gebeurt op verzoek van de opdrachtgever.</p>

<h2 class="bureau-clause">4. Ondersteuning</h2>
<p>Vragen worden behandeld op werkdagen tussen negen en zeventien uur. Bij een
storing die de toepassing onbruikbaar maakt wordt binnen vier werkuren
gereageerd.</p>

<h2 class="bureau-clause">5. Vergoeding en duur</h2>
<p>De vergoeding bedraagt {{ project.agreedValue }} per jaar, exclusief btw. De
overeenkomst loopt één jaar en wordt stilzwijgend verlengd, tenzij één van beide
partijen uiterlijk één maand voor de vervaldag schriftelijk opzegt.</p>

<h2 class="bureau-clause">6. Gegevensverwerking</h2>
<p>De opdrachtnemer treedt op als verwerker in de zin van de Algemene Verordening
Gegevensbescherming en verwerkt persoonsgegevens uitsluitend in opdracht van de
opdrachtgever.</p>

<h2 class="bureau-clause">7. Beëindiging</h2>
<p>Bij beëindiging bezorgt de opdrachtnemer op verzoek een volledige export van
de gegevens en van de broncode die aan de opdrachtgever toebehoort.</p>

${SIGNATURES}
`.trim(),
	},

	{
		key: "project_scope",
		name: "Project scope en MVP-definitie",
		description: "Wat wel en niet in de eerste versie zit. Voorbeeldtekst.",
		bodyHtml: `
<h1>Project scope en MVP-definitie</h1>
${META}
<p class="bureau-doc-meta">
	Opdrachtgever: {{ client.name }}{{#if project.name}} &middot; Project: {{ project.name }}{{/if}}
</p>

<h2 class="bureau-clause">1. Doel</h2>
<p>{{#if project.description}}{{ project.description }}{{/if}}{{#unless project.description}}Dit document beschrijft
wat de eerste bruikbare versie bevat, en even uitdrukkelijk wat zij niet
bevat.{{/unless}}</p>

<h2 class="bureau-clause">2. Binnen scope</h2>
<ol>
	<li>De schermen en functies die in de bijgevoegde lijst zijn opgenomen.</li>
	<li>Een responsieve weergave voor telefoon, tablet en desktop.</li>
	<li>Een beheeromgeving voor de inhoud die de opdrachtgever zelf aanpast.</li>
	<li>Eenmalige overname van bestaande inhoud, voor zover aangeleverd in een
		bruikbaar formaat.</li>
</ol>

<h2 class="bureau-clause">3. Buiten scope</h2>
<ol>
	<li>Functies die hierboven niet vermeld staan.</li>
	<li>Koppelingen met systemen van derden, tenzij apart overeengekomen.</li>
	<li>Het schrijven van teksten en het aanleveren van beeldmateriaal.</li>
	<li>Doorlopend onderhoud na oplevering, dat valt onder een aparte
		serviceovereenkomst.</li>
</ol>

<h2 class="bureau-clause">4. Aannames</h2>
<p>Feedback wordt gebundeld per fase aangeleverd. Toegangen tot domein, hosting
en bestaande systemen zijn beschikbaar bij aanvang.</p>

<h2 class="bureau-clause">5. Wijzigingen</h2>
<p>Een wijziging aan deze scope wordt schriftelijk vastgelegd in een addendum,
met de gevolgen voor prijs en planning erbij.</p>

{{#if project.dueOn}}<p>Streefdatum voor oplevering: {{ project.dueOn }}.</p>{{/if}}

${SIGNATURES}
`.trim(),
	},

	{
		key: "addendum",
		name: "Addendum",
		description: "Wijziging op een bestaande overeenkomst. Voorbeeldtekst.",
		bodyHtml: `
<h1>Addendum</h1>
${META}
${PARTIES}

<h2 class="bureau-clause">1. Voorwerp</h2>
<p>Dit addendum wijzigt de eerder tussen partijen gesloten overeenkomst
{{#if project.name}}met betrekking tot "{{ project.name }}"{{/if}}. Alle
bepalingen van de oorspronkelijke overeenkomst blijven onverkort gelden, behalve
waar zij hieronder uitdrukkelijk worden gewijzigd.</p>

<h2 class="bureau-clause">2. Wijziging</h2>
<p>{{ document.changeSummary }}</p>

<h2 class="bureau-clause">3. Gevolgen voor prijs</h2>
<p>{{ document.priceEffect }}</p>

<h2 class="bureau-clause">4. Gevolgen voor planning</h2>
<p>{{ document.scheduleEffect }}</p>

<h2 class="bureau-clause">5. Inwerkingtreding</h2>
<p>Dit addendum treedt in werking op {{ document.issuedOn }}.</p>

${SIGNATURES}
`.trim(),
	},
];
