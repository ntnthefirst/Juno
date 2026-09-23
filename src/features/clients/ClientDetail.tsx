import { useCallback, useEffect, useState } from "react";
import type {
	Client,
	ClientAddress,
	ClientEmail,
	ClientPhone,
	Contact,
	Project,
	ProjectSummary,
	ReferenceItem,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { MarkdownNotes } from "../../components/MarkdownNotes";

/** Tone is a token name, never a hex. See brand/BRAND.md section 5. */
const TONES: Record<string, string> = {
	ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
	warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
	risk: "bg-[var(--risk-soft)] text-[var(--risk)]",
	seal: "bg-[var(--seal-soft)] text-[var(--seal)]",
	accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
};

export function StatusBadge({ label, tone }: { label: string; tone: string | null }) {
	const classes = (tone && TONES[tone]) || "bg-[var(--sunken)] text-[var(--ink-muted)]";
	return (
		<span
			className={`inline-block shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${classes}`}
		>
			{label}
		</span>
	);
}

/** A non-breaking space, so an amount never wraps between its thousands. */
const NBSP = String.fromCharCode(0xa0);
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** Integer cents to a Belgian amount. No float arithmetic anywhere on the way. */
function formatEuros(cents: number): string {
	const absolute = Math.abs(cents);
	const whole = String(Math.trunc(absolute / 100)).replace(THOUSANDS, NBSP);
	const fraction = String(absolute % 100).padStart(2, "0");
	return `${cents < 0 ? "-" : ""}${whole},${fraction}`;
}

/** YYYY-MM-DD is a calendar date, so it is split rather than parsed as an instant. */
function formatDate(date: string | null): string {
	if (!date) return "";
	const parts = date.split("-");
	return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

type Detail = {
	client: Client;
	status: ReferenceItem | null;
	emails: ClientEmail[];
	phones: ClientPhone[];
	addresses: ClientAddress[];
	contacts: Contact[];
	projects: ProjectSummary[];
};

type Load =
	| { status: "loading" }
	| { status: "ready"; detail: Detail }
	| { status: "error"; message: string };

type DetailKind = "contact" | "project" | "email" | "phone" | "address";
type Pending = { kind: DetailKind; id: string; name: string };

const REMOVE_TITLES: Record<DetailKind, string> = {
	contact: "Remove contact",
	project: "Remove project",
	email: "Remove email",
	phone: "Remove phone number",
	address: "Remove address",
};

type ClientDetailProps = {
	clientId: string;
	onEdit: (client: Client) => void;
	onDelete: (client: Client) => void;
	/**
	 * Contacts and projects are filled in on a page of their own, which needs
	 * the whole screen rather than this pane, so the screen owns that state and
	 * this only asks for it. Null means a new one.
	 */
	onEditContact: (contact: Contact | null) => void;
	onEditProject: (project: Project | null) => void;
	/**
	 * An email, a phone number or an address is a row of something still being
	 * browsed, so it opens in a side panel rather than taking the screen. Null
	 * means a new one.
	 */
	onEditEmail: (email: ClientEmail | null) => void;
	onEditPhone: (phone: ClientPhone | null) => void;
	onEditAddress: (address: ClientAddress | null) => void;
};

export function ClientDetail({
	clientId,
	onEdit,
	onDelete,
	onEditContact,
	onEditProject,
	onEditEmail,
	onEditPhone,
	onEditAddress,
}: ClientDetailProps) {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [pending, setPending] = useState<Pending | null>(null);
	const [busy, setBusy] = useState(false);

	const fetchDetail = useCallback(async (): Promise<Detail | null> => {
		const [client, emails, phones, addresses, contacts, projects, statusSet] = await Promise.all([
			window.juno.clients.get(clientId),
			window.juno.clientEmails.listForClient(clientId),
			window.juno.clientPhones.listForClient(clientId),
			window.juno.clientAddresses.listForClient(clientId),
			window.juno.contacts.listForClient(clientId),
			window.juno.projects.list({ clientId }),
			window.juno.reference.getSet("client_status"),
		]);
		if (!client) return null;
		const status = client.statusId
			? (statusSet?.items.find((item) => item.id === client.statusId) ?? null)
			: null;
		return { client, status, emails, phones, addresses, contacts, projects };
	}, [clientId]);

	useEffect(() => {
		let cancelled = false;
		fetchDetail()
			.then((detail) => {
				if (cancelled) return;
				setLoad(
					detail
						? { status: "ready", detail }
						: { status: "error", message: "This client is no longer in your juno." },
				);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setLoad({ status: "error", message: messageOf(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [fetchDetail]);

	// Refreshing after a mutation replaces the value in place, so the pane does not
	// drop back to the loading state on every edit.
	const refresh = useCallback(() => {
		fetchDetail()
			.then((detail) => {
				if (detail) setLoad({ status: "ready", detail });
			})
			.catch((cause: unknown) => {
				setLoad({ status: "error", message: messageOf(cause) });
			});
	}, [fetchDetail]);

	async function confirmRemove() {
		if (!pending || busy) return;
		setBusy(true);
		try {
			if (pending.kind === "contact") await window.juno.contacts.remove(pending.id);
			else if (pending.kind === "project") await window.juno.projects.remove(pending.id);
			else if (pending.kind === "email") await window.juno.clientEmails.remove(pending.id);
			else if (pending.kind === "phone") await window.juno.clientPhones.remove(pending.id);
			else await window.juno.clientAddresses.remove(pending.id);
			setPending(null);
			refresh();
		} catch (cause: unknown) {
			setPending(null);
			setLoad({ status: "error", message: messageOf(cause) });
		} finally {
			setBusy(false);
		}
	}

	async function makeContactPrimary(id: string) {
		try {
			await window.juno.contacts.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makeEmailPrimary(id: string) {
		try {
			await window.juno.clientEmails.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makePhonePrimary(id: string) {
		try {
			await window.juno.clientPhones.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function makeAddressPrimary(id: string) {
		try {
			await window.juno.clientAddresses.setPrimary(id);
			refresh();
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	async function editProject(id: string) {
		try {
			const project = await window.juno.projects.get(id);
			if (project) onEditProject(project);
		} catch (cause: unknown) {
			setLoad({ status: "error", message: messageOf(cause) });
		}
	}

	if (load.status === "loading") return <p className="text-[var(--ink-muted)]">Loading.</p>;

	if (load.status === "error") {
		return (
			<div className="border-l-2 border-[var(--risk)] pl-4">
				<p className="font-[var(--weight-medium)] text-[var(--risk)]">Could not load this client.</p>
				<p data-selectable className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
					{load.message}
				</p>
			</div>
		);
	}

	const { client, status, emails, phones, addresses, contacts, projects } = load.detail;
	const primaryAddress = addresses.find((address) => address.isPrimary) ?? null;

	return (
		<div>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2
						data-selectable
						className="truncate text-[length:var(--text-h2)] font-[var(--weight-semibold)] tracking-[-0.01em]"
					>
						{client.name}
					</h2>
					<div className="mt-2 flex items-center gap-3">
						{status ? <StatusBadge label={status.label} tone={status.tone} /> : null}
						{primaryAddress?.city ? (
							<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{primaryAddress.city}
							</span>
						) : null}
					</div>
				</div>

				<div className="flex gap-2">
					<Button onClick={() => onEdit(client)}>Edit</Button>
					<Button variant="danger" onClick={() => onDelete(client)}>
						Delete
					</Button>
				</div>
			</div>

			{client.notes && client.notes.trim().length > 0 ? (
				<div className="mt-4 text-[length:var(--text-dense)]">
					<MarkdownNotes text={client.notes} />
				</div>
			) : null}

			<section className="mt-10">
				<div className="mb-4 flex items-center justify-between gap-4">
					<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Emails</h3>
					<Button size="dense" onClick={() => onEditEmail(null)}>
						Add email
					</Button>
				</div>

				{emails.length === 0 ? (
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						No email addresses for this client yet.
					</p>
				) : (
					<ul>
						{emails.map((email) => (
							<li
								key={email.id}
								className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span data-selectable className="truncate">
											{email.email}
										</span>
										{email.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
									</div>
									{email.label ? (
										<div className="mt-0.5 truncate text-[var(--ink-muted)]">{email.label}</div>
									) : null}
								</div>
								<span className="flex shrink-0 gap-1">
									{email.isPrimary ? null : (
										<Button size="dense" onClick={() => void makeEmailPrimary(email.id)}>
											Make primary
										</Button>
									)}
									<Button size="dense" onClick={() => onEditEmail(email)}>
										Edit
									</Button>
									<Button
										size="dense"
										variant="danger"
										onClick={() => setPending({ kind: "email", id: email.id, name: email.email })}
									>
										Remove
									</Button>
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="mt-10">
				<div className="mb-4 flex items-center justify-between gap-4">
					<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Phone numbers</h3>
					<Button size="dense" onClick={() => onEditPhone(null)}>
						Add phone number
					</Button>
				</div>

				{phones.length === 0 ? (
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						No phone numbers for this client yet.
					</p>
				) : (
					<ul>
						{phones.map((phone) => (
							<li
								key={phone.id}
								className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span data-selectable className="tabular truncate">
											{phone.phone}
										</span>
										{phone.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
									</div>
									{phone.label ? (
										<div className="mt-0.5 truncate text-[var(--ink-muted)]">{phone.label}</div>
									) : null}
								</div>
								<span className="flex shrink-0 gap-1">
									{phone.isPrimary ? null : (
										<Button size="dense" onClick={() => void makePhonePrimary(phone.id)}>
											Make primary
										</Button>
									)}
									<Button size="dense" onClick={() => onEditPhone(phone)}>
										Edit
									</Button>
									<Button
										size="dense"
										variant="danger"
										onClick={() => setPending({ kind: "phone", id: phone.id, name: phone.phone })}
									>
										Remove
									</Button>
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="mt-10">
				<div className="mb-4 flex items-center justify-between gap-4">
					<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Addresses</h3>
					<Button size="dense" onClick={() => onEditAddress(null)}>
						Add address
					</Button>
				</div>

				{addresses.length === 0 ? (
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						No addresses for this client yet.
					</p>
				) : (
					<ul>
						{addresses.map((address) => {
							const line = [address.addressLine1, address.postalCode, address.city]
								.filter(Boolean)
								.join(", ");
							return (
								<li
									key={address.id}
									className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<span data-selectable className="truncate font-[var(--weight-medium)]">
												{address.label ?? line}
											</span>
											{address.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
										</div>
										{address.label ? (
											<div data-selectable className="mt-0.5 truncate text-[var(--ink-muted)]">
												{line}
											</div>
										) : null}
									</div>
									<span className="flex shrink-0 gap-1">
										{address.isPrimary ? null : (
											<Button size="dense" onClick={() => void makeAddressPrimary(address.id)}>
												Make primary
											</Button>
										)}
										<Button size="dense" onClick={() => onEditAddress(address)}>
											Edit
										</Button>
										<Button
											size="dense"
											variant="danger"
											onClick={() =>
												setPending({
													kind: "address",
													id: address.id,
													name: address.label ?? line,
												})
											}
										>
											Remove
										</Button>
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</section>

			<section className="mt-10">
				<div className="mb-4 flex items-center justify-between gap-4">
					<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Contacts</h3>
					<Button size="dense" onClick={() => onEditContact(null)}>
						Add contact
					</Button>
				</div>

				{contacts.length === 0 ? (
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						No contacts for this client yet.
					</p>
				) : (
					<ul>
						{contacts.map((contact) => (
							<li
								key={contact.id}
								className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
							>
								{/* Two lines rather than columns. Fixed-width columns reserved space
								    for fields most contacts do not have, which squeezed the name to
								    a few characters even in a wide pane. */}
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span data-selectable className="truncate font-[var(--weight-medium)]">
											{contact.name}
										</span>
										{contact.isPrimary ? <StatusBadge label="Primary" tone="accent" /> : null}
									</div>
									{[contact.role, contact.email, contact.phone].some(Boolean) ? (
										<div
											data-selectable
											className="mt-0.5 truncate text-[var(--ink-muted)]"
										>
											{[contact.role, contact.email, contact.phone]
												.filter(Boolean)
												.join("  ·  ")}
										</div>
									) : null}
								</div>
								<span className="flex shrink-0 gap-1">
									{contact.isPrimary ? null : (
										<Button size="dense" onClick={() => void makeContactPrimary(contact.id)}>
											Make primary
										</Button>
									)}
									<Button size="dense" onClick={() => onEditContact(contact)}>
										Edit
									</Button>
									<Button
										size="dense"
										variant="danger"
										onClick={() =>
											setPending({ kind: "contact", id: contact.id, name: contact.name })
										}
									>
										Remove
									</Button>
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="mt-10">
				<div className="mb-4 flex items-center justify-between gap-4">
					<h3 className="text-[length:var(--text-h3)] font-[var(--weight-medium)]">Projects</h3>
					<Button size="dense" onClick={() => onEditProject(null)}>
						Add project
					</Button>
				</div>

				{projects.length === 0 ? (
					<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
						No projects for this client yet.
					</p>
				) : (
					<ul>
						{projects.map((project) => (
							<li
								key={project.id}
								className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2 text-[length:var(--text-dense)]"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span data-selectable className="truncate font-[var(--weight-medium)]">
											{project.name}
										</span>
										{project.status ? (
											<StatusBadge label={project.status.label} tone={project.status.tone} />
										) : null}
									</div>
									<div className="tabular mt-0.5 text-[var(--ink-muted)]">
										{[
											project.dueOn ? `Due ${formatDate(project.dueOn)}` : null,
											project.agreedValueCents === null
												? null
												: `€ ${formatEuros(project.agreedValueCents)}`,
										]
											.filter(Boolean)
											.join("  ·  ")}
									</div>
								</div>
								<span className="flex shrink-0 gap-1">
									<Button size="dense" onClick={() => void editProject(project.id)}>
										Edit
									</Button>
									<Button
										size="dense"
										variant="danger"
										onClick={() =>
											setPending({ kind: "project", id: project.id, name: project.name })
										}
									>
										Remove
									</Button>
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			{pending ? (
				<Dialog
					title={REMOVE_TITLES[pending.kind]}
					width="narrow"
					onClose={() => setPending(null)}
				>
					<p className="mt-3 text-[var(--ink-muted)]">
						{pending.name} is removed from {client.name}.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button onClick={() => setPending(null)}>Cancel</Button>
						<Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>
							{busy ? "Removing" : "Remove"}
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
