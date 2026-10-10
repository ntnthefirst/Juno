/**
 * What a mail template fills itself in with: its own declared inputs, and
 * nothing from a record.
 *
 * A mail template used to reach into the client, the project and the owner's
 * settings, which meant the message depended on which client was linked when
 * it was used, and that a template could not be read without a client to read
 * it against. It now works the way a document template on paper does
 * (docs/templates.md): every value it prints is an input, written
 * `{{document.<key>}}`, typed by a person or an agent when it is used.
 * Choosing a client only decides who it goes to and where it is filed.
 *
 * Pure: no Electron import and no database import, so the tests run without
 * a connection.
 */
import type { TemplateInput, TemplateInputKind } from "../../shared/types";
import { formatDate } from "./document-context";
import { isImageData, missingImage } from "./document-canvas";
import { placeholdersIn } from "./template-render";

/**
 * The context a template is rendered against: what was typed for each input,
 * trimmed, with a date as it reads in Belgium and a picture as its bytes.
 *
 * `missing` is every required input left blank. Anything else the body asks
 * for and does not get is reported by the renderer itself, as a marker.
 */
export function mailContext(
	inputs: TemplateInput[],
	values: Record<string, string>,
): { context: Record<string, unknown>; missing: string[] } {
	const document: Record<string, string> = {};
	const missing: string[] = [];
	for (const input of inputs) {
		const value = (values[input.key] ?? "").trim();
		if (input.kind === "image") {
			// Only the bytes. An address typed into a picture input is left for
			// the reader's mail client to fetch, which is what a mail is for.
			if (isImageData(value)) document[input.key] = value.replace(/\s+/g, "");
			else if (/^https:\/\//i.test(value)) document[input.key] = value;
			else {
				document[input.key] = missingImage(`document.${input.key}`);
				if (input.required) missing.push(`document.${input.key}`);
			}
			continue;
		}
		if (!value) {
			if (input.required) missing.push(`document.${input.key}`);
			continue;
		}
		document[input.key] = input.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
	}
	return { context: { document }, missing };
}

/** Every placeholder in a subject or a body that is not one of the template's own inputs. */
export function foreignMailPlaceholders(text: string, inputs: TemplateInput[]): string[] {
	const keys = new Set(inputs.map((input) => input.key));
	return placeholdersIn(text).filter((path) => {
		const [root, key, ...rest] = path.split(".");
		return !(root === "document" && key && rest.length === 0 && keys.has(key));
	});
}

/** Throws when a template refers to anything it does not ask for itself. */
export function assertOwnMailPlaceholders(subject: string, bodyHtml: string, inputs: TemplateInput[]): void {
	const foreign = [...new Set([...foreignMailPlaceholders(subject, inputs), ...foreignMailPlaceholders(bodyHtml, inputs)])];
	if (foreign.length === 0) return;
	const list = foreign.map((path) => `{{${path}}}`).join(", ");
	throw new Error(
		`This template uses ${list}, which it does not ask for. A mail template fills in only its own ` +
			"inputs, so add an input for each value and write it as {{document.<key>}}.",
	);
}

const ROOT_LABELS: Record<string, string> = {
	client: "Client",
	project: "Project",
	owner: "Your",
	document: "",
};

/** `contactName` to `contact_name`. */
function snake(word: string): string {
	return word.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** `client.contactName` to `client_contact_name`, and a document's own `dueOn` to `due_on`. */
export function keyForPath(path: string): string {
	const [root = "", ...rest] = path.split(".");
	const tail = rest.map(snake).join("_");
	const key = root === "document" ? tail : `${snake(root)}_${tail}`;
	const clean = key.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	return /^[a-z]/.test(clean) ? clean : `value_${clean}`;
}

/** `client.contactName` to "Client contact name". */
function labelForPath(path: string): string {
	const [root = "", ...rest] = path.split(".");
	const words = rest
		.map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase())
		.join(" ");
	const prefix = ROOT_LABELS[root] ?? root;
	const label = (prefix ? `${prefix} ${words}` : words).replace(/\bvat\b/, "VAT");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function kindForPath(path: string): TemplateInputKind {
	return /On$/.test(path) ? "date" : "text";
}

/** Every way a path is written, so a rewrite catches `{{x}}`, `{{ x }}`, `{{& x}}` and a conditional. */
function pathPattern(path: string): RegExp {
	const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(\\{\\{(?:#if\\s+|#unless\\s+|&?\\s*))${escaped}(\\s*\\}\\})`, "g");
}

const CONDITIONAL = /\{\{#(if|unless)\s+[\w.]+\s*\}\}[\s\S]*?\{\{\/\1\}\}/g;

/**
 * True when a path is never printed outside a conditional: such an input can
 * be left blank, because the line it is on was written to drop out.
 */
function onlyInConditions(path: string, texts: string[]): boolean {
	const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const printed = new RegExp(`\\{\\{&?\\s*${escaped}\\s*\\}\\}`);
	return !texts.some((text) => printed.test(text.replace(CONDITIONAL, "")));
}

export type AdoptableTemplate = {
	subject: string;
	bodyHtml: string;
	/** The canvas as it is stored, or null for a template written as HTML. */
	layoutJson: string | null;
	inputs: TemplateInput[];
};

/**
 * Turns every record value an older template reached for into an input of
 * its own, so the template says the same thing it said before and asks for
 * the value instead of looking it up.
 *
 * `{{client.contactName}}` becomes `{{document.client_contact_name}}` and an
 * input labelled "Client contact name". A value the owner's own settings
 * answered (`owner.businessName`) gets that answer as the input's starting
 * value, so a footer still fills itself in. A path that is only ever tested
 * by a conditional becomes an optional input; one that is printed is
 * required, because it used to be marked missing when it was blank.
 *
 * Returns null when there is nothing to change, so running it twice is the
 * same as running it once.
 */
export function adoptRecordPlaceholders(
	template: AdoptableTemplate,
	defaults: Record<string, string>,
): AdoptableTemplate | null {
	const texts = [template.subject, template.bodyHtml, template.layoutJson ?? ""];
	const foreign = [...new Set(texts.flatMap((text) => foreignMailPlaceholders(text, template.inputs)))].sort();
	if (foreign.length === 0) return null;

	const inputs = [...template.inputs];
	const taken = new Set(inputs.map((input) => input.key));
	const rewrites: { path: string; key: string }[] = [];

	for (const path of foreign) {
		let key = keyForPath(path);
		if (taken.has(key)) {
			let n = 2;
			while (taken.has(`${key}_${n}`)) n++;
			key = `${key}_${n}`;
		}
		taken.add(key);
		const input: TemplateInput = {
			key,
			label: labelForPath(path),
			kind: kindForPath(path),
			required: !onlyInConditions(path, texts),
		};
		const starting = defaults[path];
		if (starting) input.defaultValue = starting;
		inputs.push(input);
		rewrites.push({ path, key });
	}

	const rewrite = (text: string) =>
		rewrites.reduce((out, { path, key }) => out.replace(pathPattern(path), `$1document.${key}$2`), text);

	return {
		subject: rewrite(template.subject),
		bodyHtml: rewrite(template.bodyHtml),
		layoutJson: template.layoutJson === null ? null : rewrite(template.layoutJson),
		inputs,
	};
}
