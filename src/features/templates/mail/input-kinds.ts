import type { TemplateInputKind } from "@shared/types";

/** The kinds an input can be, in the order the editor offers them, with the name a person reads. */
export const KIND_OPTIONS: { value: TemplateInputKind; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "textarea", label: "Long text" },
	{ value: "number", label: "Number" },
	{ value: "money", label: "Amount" },
	{ value: "date", label: "Date" },
	{ value: "choice", label: "Choice" },
	{ value: "image", label: "Image" },
	{ value: "url", label: "Link" },
];

export function kindLabel(kind: TemplateInputKind): string {
	return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Text";
}
