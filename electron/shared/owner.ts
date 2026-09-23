/**
 * Reading the owner profile.
 *
 * The profile stores a first name, a last name and two lists of contact
 * details. Everything that wants one string, a document template, an SMTP
 * From header, a signature line, wants the same three answers, so they are
 * derived here once rather than in each caller. Pure functions, no imports, so
 * the renderer and the main process share them.
 */
import type { OwnerEmail, OwnerPhone, OwnerProfile } from "./types";

/** "Nathan Peeters", or an empty string when neither half is filled in. */
export function ownerFullName(owner: OwnerProfile): string {
	return [owner.firstName, owner.lastName]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(" ");
}

/**
 * Who the owner is, for a sentence that addresses a person. The business name
 * is the fallback because a one-person business often fills in only that, and
 * a letter signed by nobody reads worse than one signed by a company.
 */
export function ownerDisplayName(owner: OwnerProfile): string {
	return ownerFullName(owner) || owner.businessName.trim();
}

/** The address a document prints, or null when none is recorded. */
export function primaryOwnerEmail(owner: OwnerProfile): OwnerEmail | null {
	return owner.emails.find((entry) => entry.isPrimary) ?? owner.emails[0] ?? null;
}

export function primaryOwnerPhone(owner: OwnerProfile): OwnerPhone | null {
	return owner.phones.find((entry) => entry.isPrimary) ?? owner.phones[0] ?? null;
}

/** The three derived strings, for a caller that wants all of them. */
export function ownerContact(owner: OwnerProfile): {
	contactName: string;
	email: string;
	phone: string;
} {
	return {
		contactName: ownerDisplayName(owner),
		email: primaryOwnerEmail(owner)?.email ?? "",
		phone: primaryOwnerPhone(owner)?.phone ?? "",
	};
}
