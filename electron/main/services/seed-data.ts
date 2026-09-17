/**
 * The reference data Bureau ships with, as plain data. Decision 16.
 *
 * This file is the shipped truth. It is read by seed.ts on launch and by
 * reference.ts when a set is reset, so a row can always be put back the way it
 * arrived. Nothing here touches the database.
 *
 * Rules for editing it:
 * - A `seedKey` is permanent. Rename the label, never the key, or an upgrade
 *   will insert a second row instead of updating the first.
 * - `tone` is a token name from brand/tokens.css (ok, warn, risk, seal, accent)
 *   or null. Never a hex value, because the token flips with the theme and a hex
 *   does not.
 * - Labels are English. The interface is English; only client-facing output is
 *   Dutch.
 * - Raise SEED_VERSION when a shipped row changes. Adding a new row does not
 *   need it, because a missing row is inserted on every launch.
 */
import type { ReferenceSetKey } from "../../shared/types";

export const SEED_VERSION = 1;

export interface SeedItem {
	/** Stable identifier for this row, unique across every set. */
	seedKey: string;
	key: string;
	label: string;
	sortOrder: number;
	/** A token name from brand/tokens.css, or null for no colour. */
	tone: string | null;
}

export interface SeedSet {
	key: ReferenceSetKey;
	label: string;
	description: string | null;
	allowsCustomItems: boolean;
	items: SeedItem[];
}

function items(setKey: ReferenceSetKey, rows: Omit<SeedItem, "seedKey" | "sortOrder">[]): SeedItem[] {
	return rows.map((row, index) => ({
		...row,
		seedKey: `${setKey}.${row.key}`,
		sortOrder: index * 10,
	}));
}

export const SEED_SETS: SeedSet[] = [
	{
		key: "client_status",
		label: "Client status",
		description: "Where a client stands right now.",
		allowsCustomItems: true,
		items: items("client_status", [
			{ key: "lead", label: "Lead", tone: "accent" },
			{ key: "active", label: "Active", tone: "ok" },
			{ key: "dormant", label: "Dormant", tone: "warn" },
			{ key: "archived", label: "Archived", tone: null },
		]),
	},
	{
		key: "project_status",
		label: "Project status",
		description: "How far along a project is.",
		allowsCustomItems: true,
		items: items("project_status", [
			{ key: "proposed", label: "Proposed", tone: "accent" },
			{ key: "active", label: "Active", tone: "ok" },
			{ key: "on_hold", label: "On hold", tone: "warn" },
			{ key: "delivered", label: "Delivered", tone: "seal" },
			{ key: "cancelled", label: "Cancelled", tone: "risk" },
		]),
	},
	{
		key: "document_status",
		label: "Document status",
		description: "Where a contract or quote is in its life.",
		allowsCustomItems: true,
		items: items("document_status", [
			{ key: "draft", label: "Draft", tone: null },
			{ key: "sent", label: "Sent", tone: "accent" },
			{ key: "awaiting_signature", label: "Awaiting signature", tone: "warn" },
			{ key: "signed", label: "Signed", tone: "seal" },
			{ key: "expired", label: "Expired", tone: "risk" },
		]),
	},
	{
		key: "label",
		label: "Labels",
		description: "Free tags for clients and projects.",
		allowsCustomItems: true,
		items: items("label", [
			{ key: "retainer", label: "Retainer", tone: "accent" },
			{ key: "hosting", label: "Hosting", tone: "ok" },
			{ key: "one_off", label: "One-off", tone: null },
		]),
	},
];

export function seedSet(key: ReferenceSetKey): SeedSet | undefined {
	return SEED_SETS.find((set) => set.key === key);
}
