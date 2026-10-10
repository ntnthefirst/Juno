import type { TemplateInput } from "@shared/types";

export type PlaceholderItem = {
	path: string;
	description: string;
};

export type PlaceholderGroup = {
	label: string;
	items: PlaceholderItem[];
};

/**
 * Every path a mail template can refer to: its own declared inputs, and
 * nothing from a client, a project or the owner's details. The service refuses
 * a template that names anything else when it is saved
 * (electron/main/services/mail-template-fields.ts), so offering it here would
 * only offer a way to make a template that cannot be saved.
 */
export function mailPlaceholderGroups(inputs: TemplateInput[]): PlaceholderGroup[] {
	const items = inputs
		.filter((input) => input.key)
		.map((input) => ({ path: `document.${input.key}`, description: input.label || input.key }));
	return items.length > 0 ? [{ label: "This template asks for", items }] : [];
}
