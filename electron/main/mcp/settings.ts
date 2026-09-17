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
import type { OwnerProfile, ThemeSetting } from "../../shared/types";
import { applyTheme } from "../ipc/settings";
import * as settings from "../services/settings";
import type { ToolDescriptor } from "./types";

const OWNER_FIELDS: (keyof OwnerProfile)[] = [
	"businessName",
	"contactName",
	"email",
	"phone",
	"vatNumber",
	"addressLine1",
	"addressLine2",
	"postalCode",
	"city",
	"country",
	"iban",
];

const ownerProperties: Record<string, unknown> = {
	business_name: { type: "string", description: "The registered business name." },
	contact_name: { type: "string", description: "The person clients correspond with." },
	email: { type: "string", description: "Business email address." },
	phone: { type: "string", description: "Business phone number." },
	vat_number: { type: "string", description: "VAT number in BE0123456789 format." },
	address_line1: { type: "string", description: "Street and number." },
	address_line2: { type: "string", description: "Extra address line, usually empty." },
	postal_code: { type: "string", description: "Postal code." },
	city: { type: "string", description: "City." },
	country: { type: "string", description: "Country name." },
	iban: { type: "string", description: "IBAN, shown on documents. Never a card number." },
};

/** business_name in the tool schema, businessName in the service. */
function snake(field: keyof OwnerProfile): string {
	return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
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
			"The business details that appear on generated documents: name, address, VAT number, IBAN.",
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
			const patch: Partial<OwnerProfile> = {};
			for (const field of OWNER_FIELDS) {
				const value = args[snake(field)];
				if (value !== undefined) patch[field] = String(value);
			}
			return settings.setOwner(patch);
		},
	},
];

export default settingsTools;
