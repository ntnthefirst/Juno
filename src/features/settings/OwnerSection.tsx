import { useEffect, useState } from "react";
import type { MailAccount, OwnerEmail, OwnerPhone, OwnerProfile, OwnerProfilePatch } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { OwnerContactList } from "./OwnerContacts";
import { Section, SectionError } from "./Section";

type OwnerSectionProps = { onSaved: (message: string) => void };

const FIELDS: { key: keyof Omit<OwnerProfile, "emails" | "phones">; label: string; help?: string }[] = [
	{ key: "firstName", label: "First name" },
	{ key: "lastName", label: "Last name" },
	{ key: "businessName", label: "Business name" },
	{ key: "vatNumber", label: "VAT number" },
	{
		key: "establishmentNumber",
		label: "Establishment number",
		help: "Your vestigingsnummer. Not the VAT number.",
	},
	{ key: "iban", label: "IBAN" },
	{ key: "addressLine1", label: "Address" },
	{ key: "addressLine2", label: "Address, second line" },
	{ key: "postalCode", label: "Postal code" },
	{ key: "city", label: "City" },
	{ key: "country", label: "Country" },
];

export function OwnerSection({ onSaved }: OwnerSectionProps) {
	const [profile, setProfile] = useState<OwnerProfile | null>(null);
	const [mailAccounts, setMailAccounts] = useState<MailAccount[] | null>(null);
	const [detailsError, setDetailsError] = useState<string | null>(null);
	const [emailsError, setEmailsError] = useState<string | null>(null);
	const [phonesError, setPhonesError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.settings
			.getOwner()
			.then((value) => {
				if (!cancelled) setProfile(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setDetailsError(messageOf(cause));
			});
		// A mail account this address matches is shown as a quiet hint below. If
		// this fails to load, the hint is just missing; it is not worth its own
		// error banner on a screen about the owner's contact details.
		window.juno.mail.accounts
			.list()
			.then((rows) => {
				if (!cancelled) setMailAccounts(rows);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	async function save() {
		if (!profile || busy) return;
		setBusy(true);
		setDetailsError(null);
		try {
			// Only the fields on this form. The two lists are edited one entry at a
			// time and the service ignores them here, so sending them would be a
			// stale copy travelling for nothing.
			const patch: OwnerProfilePatch = {};
			for (const field of FIELDS) patch[field.key] = profile[field.key];
			setProfile(await window.juno.settings.setOwner(patch));
			onSaved("Your details were saved.");
		} catch (cause: unknown) {
			setDetailsError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function applyEmail(action: () => Promise<OwnerProfile>, message?: string) {
		setEmailsError(null);
		try {
			setProfile(await action());
			if (message) onSaved(message);
		} catch (cause: unknown) {
			setEmailsError(messageOf(cause));
		}
	}

	async function applyPhone(action: () => Promise<OwnerProfile>, message?: string) {
		setPhonesError(null);
		try {
			setProfile(await action());
			if (message) onSaved(message);
		} catch (cause: unknown) {
			setPhonesError(messageOf(cause));
		}
	}

	const markedEmails = new Set((mailAccounts ?? []).map((account) => account.email.toLowerCase()));

	return (
		<>
			<Section
				title="Your details"
				description="Printed on the contracts and emails you send clients."
				action={
					<Button size="dense" variant="primary" disabled={!profile || busy} onClick={() => void save()}>
						Save
					</Button>
				}
			>
				{profile === null ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : (
					<div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
						{FIELDS.map((field) => (
							<Field
								key={field.key}
								label={field.label}
								help={field.help}
								value={profile[field.key]}
								onChange={(value) => setProfile({ ...profile, [field.key]: value })}
							/>
						))}
					</div>
				)}
				<SectionError message={detailsError} />
			</Section>

			<Section
				title="Email addresses"
				description="Documents print the primary one."
			>
				{profile === null ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : (
					<OwnerContactList<OwnerEmail>
						items={profile.emails}
						getValue={(item) => item.email}
						inputType="email"
						valueLabel="Email address"
						valuePlaceholder="name@example.com"
						labelPlaceholder="invoices, ..."
						emptyText="No email addresses yet."
						markedValues={markedEmails}
						markedText="Mail account"
						onAdd={(email, label) =>
							applyEmail(() => window.juno.settings.addOwnerEmail({ email, label }), "Email address added.")
						}
						onUpdate={(id, email, label) =>
							applyEmail(
								() => window.juno.settings.updateOwnerEmail(id, { email, label }),
								"Email address saved.",
							)
						}
						onMakePrimary={(id) =>
							applyEmail(() => window.juno.settings.updateOwnerEmail(id, { isPrimary: true }))
						}
						onRemove={(id) =>
							applyEmail(() => window.juno.settings.removeOwnerEmail(id), "Email address removed.")
						}
					/>
				)}
				<SectionError message={emailsError} />
			</Section>

			<Section
				title="Phone numbers"
				description="Documents print the primary one."
			>
				{profile === null ? (
					<p className="text-[var(--ink-muted)]">Loading.</p>
				) : (
					<OwnerContactList<OwnerPhone>
						items={profile.phones}
						getValue={(item) => item.phone}
						inputType="tel"
						valueLabel="Phone number"
						valuePlaceholder="+32 ..."
						labelPlaceholder="gsm, office, ..."
						emptyText="No phone numbers yet."
						onAdd={(phone, label) =>
							applyPhone(() => window.juno.settings.addOwnerPhone({ phone, label }), "Phone number added.")
						}
						onUpdate={(id, phone, label) =>
							applyPhone(
								() => window.juno.settings.updateOwnerPhone(id, { phone, label }),
								"Phone number saved.",
							)
						}
						onMakePrimary={(id) =>
							applyPhone(() => window.juno.settings.updateOwnerPhone(id, { isPrimary: true }))
						}
						onRemove={(id) =>
							applyPhone(() => window.juno.settings.removeOwnerPhone(id), "Phone number removed.")
						}
					/>
				)}
				<SectionError message={phonesError} />
			</Section>
		</>
	);
}
