import { useState } from "react";
import type { Client, ClientAddress, ClientEmail, ClientLink, ClientPhone } from "@shared/types";
import { CLIENT_LANGUAGES, clientLanguageLabel } from "@shared/client-language";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { StatusBadge } from "../../components/StatusBadge";
import { DetailRow } from "./DetailRow";
import { DetailValue } from "./DetailValue";
import { messageOf } from "../../lib/errors";

/** What the remove dialog needs to ask about one value. */
export type DetailRemoval = { kind: "email" | "phone" | "address" | "link" | "website"; id: string; name: string };

type ClientDetailsProps = {
	client: Client;
	emails: ClientEmail[];
	phones: ClientPhone[];
	addresses: ClientAddress[];
	links: ClientLink[];
	/** A value changed, so the record is read again. Resolves once it has been. */
	onChanged: () => Promise<void>;
	/** An address has several fields, so it is edited in its side panel. Null adds one. */
	onEditAddress: (address: ClientAddress | null) => void;
	/** A label (and a link's kind) is edited in the value's side panel. */
	onEditEmail: (email: ClientEmail) => void;
	onEditPhone: (phone: ClientPhone) => void;
	onEditLink: (link: ClientLink) => void;
	/** Asks before anything goes, with the existing dialog. */
	onRemove: (removal: DetailRemoval) => void;
};

/** A website is shown as typed but only ever opened over https, per the app's
 *  navigation policy in electron/main/windows/chrome.ts. */
function websiteHref(website: string): string {
	return /^https?:\/\//i.test(website) ? website.replace(/^http:\/\//i, "https://") : `https://${website}`;
}

/** An address as it reads in a row: the address without its scheme or trailing slash. */
function shortUrl(url: string): string {
	return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function addressLine(address: ClientAddress): string {
	return [address.addressLine1, [address.postalCode, address.city].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");
}

const LINK_CLASS =
	"min-w-0 truncate rounded-[var(--radius-sm)] text-left text-base text-[var(--accent)] hover:text-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * The client's details as one list, a row per kind, every value of that kind
 * in its row (frame 170:12408). Values are changed where they are: a double
 * click edits one, hovering offers Make primary and remove, and hovering a
 * row offers one more. Everything goes through the services the side panels
 * already use; only an address, which has several fields, still opens its
 * panel.
 */
export function ClientDetails({
	client,
	emails,
	phones,
	addresses,
	links,
	onChanged,
	onEditAddress,
	onEditEmail,
	onEditPhone,
	onEditLink,
	onRemove,
}: ClientDetailsProps) {
	// What failed outside a field (Make primary, opening a link), said under the list.
	const [problem, setProblem] = useState<string | null>(null);

	async function run(action: () => Promise<unknown>) {
		setProblem(null);
		try {
			await action();
			await onChanged();
		} catch (cause: unknown) {
			setProblem(messageOf(cause));
		}
	}

	/** An in-place save: the field shows the message when it throws, so this does not catch. */
	async function save(action: () => Promise<unknown>) {
		await action();
		await onChanged();
	}

	async function openLink(id: string) {
		setProblem(null);
		try {
			await window.juno.clientLinks.open(id);
		} catch (cause: unknown) {
			setProblem(messageOf(cause));
		}
	}

	function primaryOrLabel(isPrimary: boolean, label: string | null) {
		if (isPrimary) return <StatusBadge label="Primary" tone="accent" />;
		return label ? <span className="min-w-0 truncate text-sm text-[var(--ink-muted)]">{label}</span> : null;
	}

	function valueActions(
		name: string,
		isPrimary: boolean,
		makePrimary: (() => void) | null,
		remove: () => void,
		panel?: { label: string; open: () => void },
	) {
		return (
			<>
				{!isPrimary && makePrimary ? (
					<Button size="dense" onClick={makePrimary}>
						Make primary
					</Button>
				) : null}
				{panel ? <IconButton icon="edit" label={panel.label} opensPanel onClick={panel.open} /> : null}
				<IconButton icon="remove" label={`Remove ${name}`} danger onClick={remove} />
			</>
		);
	}

	const notSet = <span className="text-base text-[var(--ink-muted)]">Not set</span>;

	return (
		<section>
			<h3 className="mb-2 text-h3">Details</h3>

			<DetailRow
				label="Email"
				empty={emails.length === 0}
				add={{
					label: "Add email",
					input: {
						ariaLabel: "New email address",
						type: "email",
						placeholder: "name@example.be",
						onCreate: (email) => save(() => window.juno.clientEmails.create({ clientId: client.id, email })),
					},
				}}
			>
				{emails.map((email) => (
					<DetailValue
						key={email.id}
						editLabel={`Edit ${email.email}`}
						edit={{
							initial: email.email,
							ariaLabel: "Email address",
							type: "email",
							onSave: (value) => save(() => window.juno.clientEmails.update(email.id, { email: value })),
						}}
						actions={valueActions(
							email.email,
							email.isPrimary,
							() => void run(() => window.juno.clientEmails.setPrimary(email.id)),
							() => onRemove({ kind: "email", id: email.id, name: email.email }),
							{ label: "Edit label", open: () => onEditEmail(email) },
						)}
					>
						<span data-selectable className="min-w-0 truncate text-base">
							{email.email}
						</span>
						{primaryOrLabel(email.isPrimary, email.label)}
					</DetailValue>
				))}
			</DetailRow>

			<DetailRow
				label="Phone"
				empty={phones.length === 0}
				add={{
					label: "Add phone",
					input: {
						ariaLabel: "New phone number",
						type: "tel",
						placeholder: "+32 470 12 34 56",
						onCreate: (phone) => save(() => window.juno.clientPhones.create({ clientId: client.id, phone })),
					},
				}}
			>
				{phones.map((phone) => (
					<DetailValue
						key={phone.id}
						editLabel={`Edit ${phone.phone}`}
						edit={{
							initial: phone.phone,
							ariaLabel: "Phone number",
							type: "tel",
							onSave: (value) => save(() => window.juno.clientPhones.update(phone.id, { phone: value })),
						}}
						actions={valueActions(
							phone.phone,
							phone.isPrimary,
							() => void run(() => window.juno.clientPhones.setPrimary(phone.id)),
							() => onRemove({ kind: "phone", id: phone.id, name: phone.phone }),
							{ label: "Edit label", open: () => onEditPhone(phone) },
						)}
					>
						<span data-selectable className="tabular min-w-0 truncate text-base">
							{phone.phone}
						</span>
						{primaryOrLabel(phone.isPrimary, phone.label)}
					</DetailValue>
				))}
			</DetailRow>

			<DetailRow
				label="Address"
				empty={addresses.length === 0}
				add={{ label: "Add address", onOpen: () => onEditAddress(null) }}
			>
				{addresses.map((address) => {
					const line = addressLine(address);
					return (
						<DetailValue
							key={address.id}
							editLabel={`Edit ${line}`}
							onOpen={() => onEditAddress(address)}
							actions={valueActions(
								line,
								address.isPrimary,
								() => void run(() => window.juno.clientAddresses.setPrimary(address.id)),
								() => onRemove({ kind: "address", id: address.id, name: address.label ?? line }),
							)}
						>
							<span data-selectable className="tabular min-w-0 truncate text-base">
								{line}
							</span>
							{primaryOrLabel(address.isPrimary, address.label)}
						</DetailValue>
					);
				})}
			</DetailRow>

			<DetailRow
				label="Links"
				empty={!client.website && links.length === 0}
				add={{
					label: "Add link",
					input: {
						ariaLabel: "New link",
						type: "url",
						placeholder: "https://www.linkedin.com/company/...",
						onCreate: (url) => save(() => window.juno.clientLinks.create({ clientId: client.id, url })),
					},
				}}
			>
				{client.website ? (
					<DetailValue
						editLabel={`Edit ${client.website}`}
						edit={{
							initial: client.website,
							ariaLabel: "Website",
							type: "url",
							onSave: (value) => save(() => window.juno.clients.update(client.id, { website: value || null })),
						}}
						actions={valueActions(client.website, true, null, () =>
							onRemove({ kind: "website", id: client.id, name: client.website ?? "" }),
						)}
					>
						<a
							href={websiteHref(client.website)}
							target="_blank"
							rel="noopener noreferrer"
							// A double click edits the value, so only the first click opens it.
							onClick={(event) => {
								if (event.detail > 1) event.preventDefault();
							}}
							className={LINK_CLASS}
						>
							{shortUrl(client.website)}
						</a>
					</DetailValue>
				) : null}
				{links.map((link) => (
					<DetailValue
						key={link.id}
						editLabel={`Edit ${link.url}`}
						edit={{
							initial: link.url,
							ariaLabel: "Link",
							type: "url",
							onSave: (value) => save(() => window.juno.clientLinks.update(link.id, { url: value })),
						}}
						actions={valueActions(
							shortUrl(link.url),
							true,
							null,
							() => onRemove({ kind: "link", id: link.id, name: link.label ?? link.url }),
							{ label: "Edit label and kind", open: () => onEditLink(link) },
						)}
					>
						<button
							type="button"
							onClick={(event) => {
								if (event.detail <= 1) void openLink(link.id);
							}}
							className={LINK_CLASS}
						>
							{shortUrl(link.url)}
						</button>
						{link.label ? <span className="min-w-0 truncate text-sm text-[var(--ink-muted)]">{link.label}</span> : null}
					</DetailValue>
				))}
			</DetailRow>

			<DetailRow label="VAT number" empty={false}>
				<DetailValue
					editLabel="Edit VAT number"
					edit={{
						initial: client.vatNumber ?? "",
						ariaLabel: "VAT number",
						placeholder: "BE0123456789",
						onSave: (value) => save(() => window.juno.clients.update(client.id, { vatNumber: value || null })),
					}}
				>
					{client.vatNumber ? (
						<span data-selectable className="tabular min-w-0 truncate text-base">
							{client.vatNumber}
						</span>
					) : (
						notSet
					)}
				</DetailValue>
			</DetailRow>

			<DetailRow label="Language" empty={false}>
				<DetailValue
					editLabel="Edit language"
					edit={{
						initial: client.language,
						ariaLabel: "Language",
						options: CLIENT_LANGUAGES,
						onSave: (value) => save(() => window.juno.clients.update(client.id, { language: value })),
					}}
				>
					<span className="min-w-0 truncate text-base">{clientLanguageLabel(client.language)}</span>
				</DetailValue>
			</DetailRow>
			{problem ? (
				<p role="alert" data-selectable className="mt-2 text-sm text-[var(--risk)]">
					{problem}
				</p>
			) : null}
		</section>
	);
}
