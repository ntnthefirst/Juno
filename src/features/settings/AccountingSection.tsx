import { useEffect, useState } from "react";
import type { AccountingTool } from "@shared/types";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

export function AccountingSection({ onSaved }: { onSaved: (message: string) => void }) {
	const [tool, setTool] = useState<AccountingTool | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.bureau.settings
			.getAccountingTool()
			.then((value) => {
				if (!cancelled) setTool(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save() {
		if (!tool || busy) return;
		setBusy(true);
		setError(null);
		try {
			setTool(await window.bureau.settings.setAccountingTool(tool));
			onSaved("Your accounting tool was saved.");
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Section
			title="Accounting"
			description="Bureau never raises an invoice or moves money. It tells you when one is due and links to wherever invoicing actually happens, which is what you put here."
			action={
				<Button size="dense" variant="primary" disabled={!tool || busy} onClick={() => void save()}>
					Save
				</Button>
			}
		>
			{tool === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
					<Field
						label="Name"
						value={tool.name}
						onChange={(value) => setTool({ ...tool, name: value })}
						placeholder="Your accounting tool"
					/>
					<Field
						label="Link"
						type="url"
						value={tool.url}
						onChange={(value) => setTool({ ...tool, url: value })}
						placeholder="https://"
					/>
				</div>
			)}
			<SectionError message={error} />
		</Section>
	);
}
