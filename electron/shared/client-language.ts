/**
 * What a client is written to in. `nl` is Dutch addressed with "u" and `nl-je`
 * Dutch with "je", because a template holds one register for a whole document
 * and the client decides which one that is.
 */
export const CLIENT_LANGUAGES = [
	{ value: "nl", label: 'Dutch, "u"' },
	{ value: "nl-je", label: 'Dutch, "je"' },
	{ value: "fr", label: "French" },
	{ value: "en", label: "English" },
] as const;

export type ClientLanguage = (typeof CLIENT_LANGUAGES)[number]["value"];

export const DEFAULT_CLIENT_LANGUAGE: ClientLanguage = "nl";

export function isClientLanguage(value: unknown): value is ClientLanguage {
	return CLIENT_LANGUAGES.some((language) => language.value === value);
}

export function clientLanguageLabel(value: string): string {
	return CLIENT_LANGUAGES.find((language) => language.value === value)?.label ?? value;
}
