import { useEffect, useState } from "react";
import type { AppInfo, ThemeSetting } from "@shared/types";
import { Toast } from "../../components/Toast";
import { AppearanceSection } from "./AppearanceSection";
import { BackupSection } from "./BackupSection";
import { LockSection } from "./LockSection";
import { OwnerSection } from "./OwnerSection";
import { ReferenceSection } from "./ReferenceSection";
import { SignatureSection } from "./SignatureSection";
import { messageOf } from "../../lib/errors";
import { Section } from "./Section";

export function SettingsScreen({
	theme,
	onThemeChange,
}: {
	theme: ThemeSetting;
	onThemeChange: (next: ThemeSetting) => void;
}) {
	const [toast, setToast] = useState<string | null>(null);

	return (
		<div className="p-8">
			<h1 className="text-[length:var(--text-h1)] font-[var(--weight-semibold)] tracking-[-0.02em]">
				Settings
			</h1>

			<div className="mt-8 max-w-[860px]">
				<AppearanceSection theme={theme} onChange={onThemeChange} />
				<LockSection />
				<ReferenceSection />
				<OwnerSection onSaved={setToast} />
				<SignatureSection />
				<BackupSection onDone={setToast} />
				<AboutSection />
			</div>

			{toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
		</div>
	);
}

function AboutSection() {
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		window.bureau.app
			.info()
			.then((value) => {
				if (!cancelled) setInfo(value);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Section title="About">
			{error ? (
				<p className="text-[var(--risk)]">{error}</p>
			) : info === null ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : (
				<dl className="flex flex-col gap-2 text-[length:var(--text-dense)]">
					<Row label="Version">
						{info.version}
						{info.isDev ? " (development build)" : ""}
					</Row>
					<Row label="Platform">{info.platform}</Row>
					<Row label="Database">
						<span data-selectable className="break-all">
							{info.databasePath}
						</span>
					</Row>
				</dl>
			)}
		</Section>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-4">
			<dt className="w-[92px] shrink-0 text-[var(--ink-muted)]">{label}</dt>
			<dd className="min-w-0">{children}</dd>
		</div>
	);
}
