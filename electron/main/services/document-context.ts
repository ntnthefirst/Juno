/**
 * Turns records into the values a template refers to.
 *
 * Pure, so the formatting that ends up in a contract is tested rather than
 * assumed. Belgian conventions throughout, because everything client-facing is
 * Dutch (Belgium): dates as 14/11/2026 and money as 2 100,00 with a non-breaking
 * thousands space.
 */
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientPhone,
	Contact,
	OwnerProfile,
	Project,
} from "../../shared/types";

export const NBSP = " ";

/** `YYYY-MM-DD` to `DD/MM/YYYY`, without going through Date and back. */
export function formatDate(value: string | null | undefined): string {
	if (!value) return "";
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return value;
	return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Integer cents to `2 100,00`. Never a float multiply. */
export function formatCents(cents: number | null | undefined): string {
	if (cents === null || cents === undefined) return "";
	const negative = cents < 0;
	const absolute = Math.abs(Math.trunc(cents));
	const euros = Math.trunc(absolute / 100);
	const remainder = absolute % 100;

	const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
	const decimals = String(remainder).padStart(2, "0");
	return `${negative ? "-" : ""}${grouped},${decimals}`;
}

export function formatEuros(cents: number | null | undefined): string {
	const amount = formatCents(cents);
	return amount ? `€${NBSP}${amount}` : "";
}

/**
 * A UTC instant as `18/09/2026 om 12:00`, in local time.
 *
 * A contract is read by a person, so an ISO timestamp on the page is a leak of
 * the storage format into the document. The audit page keeps the exact UTC
 * value, labelled as such, because there precision is the point.
 */
export function formatDateTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` +
		` om ${pad(date.getHours())}:${pad(date.getMinutes())}`
	);
}

export function todayIsoDate(now = new Date()): string {
	// The local calendar date, not the UTC one. A contract issued at 01:00 in
	// Brussels is dated today, and toISOString() would date it yesterday.
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export interface ContextSources {
	owner: OwnerProfile;
	client: Client;
	/** The client's primary email, phone and address, resolved by the caller. */
	primaryEmail?: ClientEmail | null;
	primaryPhone?: ClientPhone | null;
	primaryAddress?: ClientAddress | null;
	primaryContact?: Contact | null;
	project?: Project | null;
	/** Values the operator typed for this document, such as an addendum summary. */
	extras?: Record<string, string>;
	issuedOn?: string;
	title?: string;
}

export function buildContext(sources: ContextSources): Record<string, unknown> {
	const issuedOn = sources.issuedOn ?? todayIsoDate();

	return {
		owner: {
			...sources.owner,
			// The template addresses a person, and the profile may only name a
			// business. Falling back keeps the sentence grammatical.
			contactName: sources.owner.contactName || sources.owner.businessName,
		},
		client: {
			name: sources.client.name,
			email: sources.primaryEmail?.email ?? "",
			phone: sources.primaryPhone?.phone ?? "",
			website: sources.client.website ?? "",
			vatNumber: sources.client.vatNumber ?? "",
			addressLine1: sources.primaryAddress?.addressLine1 ?? "",
			addressLine2: sources.primaryAddress?.addressLine2 ?? "",
			postalCode: sources.primaryAddress?.postalCode ?? "",
			city: sources.primaryAddress?.city ?? "",
			country: sources.primaryAddress?.country ?? "",
			contactName: sources.primaryContact?.name ?? "",
			contactRole: sources.primaryContact?.role ?? "",
			contactEmail: sources.primaryContact?.email ?? "",
		},
		project: sources.project
			? {
					name: sources.project.name,
					description: sources.project.description ?? "",
					startsOn: formatDate(sources.project.startsOn),
					dueOn: formatDate(sources.project.dueOn),
					agreedValue: formatEuros(sources.project.agreedValueCents),
					agreedValueCents: sources.project.agreedValueCents ?? "",
				}
			: {},
		document: {
			title: sources.title ?? "",
			issuedOn: formatDate(issuedOn),
			issuedOnIso: issuedOn,
			...(sources.extras ?? {}),
		},
	};
}
