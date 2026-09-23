/**
 * The agent surface for application settings.
 *
 * What is deliberately not here:
 * - **Nothing about the lock.** Not the method, not the timings, and above all
 *   no way to unlock. An agent may be told the app is locked; it may never be
 *   the thing that opens it (.claude/rules/security.md).
 * - **No whole-settings read**, because that object carries the lock section and
 *   an adapter is not allowed to reshape a service's return to hide part of it.
 *
 * set_theme goes through ../ipc/settings.ts so that it performs exactly the same
 * two writes the interface does: the stored setting and nativeTheme. Applying
 * only one leaves a light title bar over a dark window (decision 14).
 */
import type { OwnerProfilePatch, ThemeSetting } from "../../shared/types";
import { applyTheme } from "../ipc/settings";
import * as settings from "../services/settings";
import type { ToolDescriptor } from "./types";

const OWNER_FIELDS: (keyof OwnerProfilePatch)[] = [
	"businessName",
	"firstName",
	"lastName",
	"vatNumber",
	"establishmentNumber",
	"addressLine1",
	"addressLine2",
	"postalCode",
	"city",
	"country",
	"iban",
];

const ownerProperties: Record<string, unknown> = {
	business_name: { type: "string", description: "The registered business name." },
	first_name: { type: "string", description: "The owner's first name." },
	last_name: { type: "string", description: "The owner's last name." },
	vat_number: { type: "string", description: "VAT number in BE0123456789 format." },
	establishment_number: {
		type: "string",
		description:
			"Establishment unit number of the registered office, the Belgian vestigingsnummer starting with a 2. Not the enterprise number.",
	},
	address_line1: { type: "string", description: "Street and number." },
	address_line2: { type: "string", description: "Extra address line, usually empty." },
	postal_code: { type: "string", description: "Postal code." },
	city: { type: "string", description: "City." },
	country: { type: "string", description: "Country name." },
	iban: { type: "string", description: "IBAN, shown on documents. Never a card number." },
};

/** business_name in the tool schema, businessName in the service. */
function snake(field: keyof OwnerProfilePatch): string {
	return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const LABEL_FIELD = {
	type: "string",
	description: "What it is for, in the owner's words. \"Invoices\", \"old domain\". Optional.",
};

const PRIMARY_FIELD = {
	type: "boolean",
	description:
		"Make this the one a generated document prints. There is exactly one primary, so this clears the flag on the others.",
};

/** A string argument, or undefined when the caller left it out. */
function text(value: unknown): string | undefined {
	return value === undefined ? undefined : String(value);
}

function flag(value: unknown): boolean | undefined {
	return value === undefined ? undefined : value === true;
}

function requireId(value: unknown, what: string): string {
	const id = typeof value === "string" ? value.trim() : "";
	if (!id) throw new Error(`Pass the ${what}, as returned by settings.get_owner.`);
	return id;
}

export const settingsTools: ToolDescriptor[] = [
	{
		name: "settings.get_theme",
		title: "Get the theme",
		description: "The interface theme: system, light or dark.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: () => settings.getTheme(),
	},
	{
		name: "settings.set_theme",
		title: "Set the theme",
		description:
			"Changes the interface theme. system follows the operating system, which is the default and usually what a person wants.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				theme: {
					type: "string",
					enum: ["system", "light", "dark"],
					description: "Which theme to apply.",
				},
			},
			required: ["theme"],
			additionalProperties: false,
		},
		handler: (args) => applyTheme(args.theme as ThemeSetting),
	},
	{
		name: "settings.get_owner",
		title: "Get the owner profile",
		description:
			"The business details that appear on generated documents: name, address, VAT number, IBAN, and every email address and phone number the owner has recorded. Each address carries an id, which the other owner tools take.",
		readOnly: true,
		requiresConfirmation: false,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		handler: () => settings.getOwner(),
	},
	{
		name: "settings.set_owner",
		title: "Update the owner profile",
		description:
			"Changes one or more of the business details used on generated documents. Fields left out keep their current value.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: ownerProperties,
			additionalProperties: false,
		},
		handler: (args) => {
			const patch: OwnerProfilePatch = {};
			for (const field of OWNER_FIELDS) {
				const value = args[snake(field)];
				if (value !== undefined) patch[field] = String(value);
			}
			return settings.setOwner(patch);
		},
	},
	{
		name: "settings.add_owner_email",
		title: "Record an owner email address",
		description:
			"Adds one of the owner's own email addresses. An address that is never read is still worth recording, so nothing here checks whether mail reaches it. An address already on the list is not added twice; the label and the primary flag still apply. Returns the whole profile.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				email: { type: "string", description: "The address, as it should be printed." },
				label: LABEL_FIELD,
				is_primary: PRIMARY_FIELD,
			},
			required: ["email"],
			additionalProperties: false,
		},
		handler: (args) =>
			settings.addOwnerEmail({
				email: String(args.email),
				label: text(args.label),
				isPrimary: flag(args.is_primary),
			}),
	},
	{
		name: "settings.update_owner_email",
		title: "Change an owner email address",
		description:
			"Changes one recorded address: the address itself, its label, or which one is primary. Fields left out keep their current value. Returns the whole profile.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				email_id: { type: "string", description: "The id from settings.get_owner." },
				email: { type: "string", description: "The new address." },
				label: LABEL_FIELD,
				is_primary: PRIMARY_FIELD,
			},
			required: ["email_id"],
			additionalProperties: false,
		},
		handler: (args) =>
			settings.updateOwnerEmail(requireId(args.email_id, "email_id"), {
				email: text(args.email),
				label: text(args.label),
				isPrimary: flag(args.is_primary),
			}),
	},
	{
		name: "settings.remove_owner_email",
		title: "Remove an owner email address",
		description:
			"Takes one address off the owner's list. Nothing else is touched, and a mail account with the same address keeps working. Returns the whole profile.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { email_id: { type: "string", description: "The id from settings.get_owner." } },
			required: ["email_id"],
			additionalProperties: false,
		},
		handler: (args) => settings.removeOwnerEmail(requireId(args.email_id, "email_id")),
	},
	{
		name: "settings.add_owner_phone",
		title: "Record an owner phone number",
		description:
			"Adds one of the owner's own phone numbers. A number already on the list is not added twice; the label and the primary flag still apply. Returns the whole profile.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				phone: { type: "string", description: "The number, as it should be printed." },
				label: LABEL_FIELD,
				is_primary: PRIMARY_FIELD,
			},
			required: ["phone"],
			additionalProperties: false,
		},
		handler: (args) =>
			settings.addOwnerPhone({
				phone: String(args.phone),
				label: text(args.label),
				isPrimary: flag(args.is_primary),
			}),
	},
	{
		name: "settings.update_owner_phone",
		title: "Change an owner phone number",
		description:
			"Changes one recorded number: the number itself, its label, or which one is primary. Fields left out keep their current value. Returns the whole profile.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: {
				phone_id: { type: "string", description: "The id from settings.get_owner." },
				phone: { type: "string", description: "The new number." },
				label: LABEL_FIELD,
				is_primary: PRIMARY_FIELD,
			},
			required: ["phone_id"],
			additionalProperties: false,
		},
		handler: (args) =>
			settings.updateOwnerPhone(requireId(args.phone_id, "phone_id"), {
				phone: text(args.phone),
				label: text(args.label),
				isPrimary: flag(args.is_primary),
			}),
	},
	{
		name: "settings.remove_owner_phone",
		title: "Remove an owner phone number",
		description: "Takes one number off the owner's list. Returns the whole profile.",
		readOnly: false,
		requiresConfirmation: true,
		inputSchema: {
			type: "object",
			properties: { phone_id: { type: "string", description: "The id from settings.get_owner." } },
			required: ["phone_id"],
			additionalProperties: false,
		},
		handler: (args) => settings.removeOwnerPhone(requireId(args.phone_id, "phone_id")),
	},
];

export default settingsTools;
