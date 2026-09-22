import { useEffect, useState } from "react";
import type { OwnerProfile } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

const FIELDS: { key: keyof OwnerProfile; label: string; type?: "email" | "tel" }[] = [
	{ key: "businessName", label: "Business name" },
	{ key: "contactName", label: "Your name" },
	{ key: "email", label: "Email", type: "email" },
	{ key: "phone", label: "Phone", type: "tel" },
	{ key: "vatNumber", label: "VAT number" },
	{ key: "iban", label: "IBAN" },
	{ key: "addressLine1", label: "Address" },
	{ key: "addressLine2", label: "Address, second line" },
	{ key: "postalCode", label: "Postal code" },
	{ key: "city", label: "City" },
	{ key: "country", label: "Country" },
];

export function OwnerSection({ onSaved }: { onSaved: (message: string) => void }) {
	const [profile, setProfile] = useState<OwnerProfile | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.juno.settings
			.getOwner()
			.then((value) => {
				if (!cancelled) setProfile(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save() {
		if (!profile || busy) return;
		setBusy(true);
		setError(null);
		try {
			setProfile(await window.juno.settings.setOwner(profile));
			onSaved("Your details were saved.");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Section
			title="Your details"
			description="These fill the contracts and emails Juno generates later, so what you put here ends up in front of clients."
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
							type={field.type}
							value={profile[field.key]}
							onChange={(value) => setProfile({ ...profile, [field.key]: value })}
						/>
					))}
				</div>
			)}
			<SectionError message={error} />
		</Section>
	);
}
