/**
 * How dates and amounts read in what Juno writes for a client.
 *
 * Pure, so the formatting that ends up in a letter is tested rather than
 * assumed. Belgian conventions throughout, because everything client-facing is
 * Dutch (Belgium): dates as 14/11/2026 and money as 2 100,00 with a non-breaking
 * thousands space.
 */
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
