import type { DocumentVersion } from "@shared/types";
import { IconAction } from "../../components/IconAction";
import { detailOf, formatInstant, KIND_LABELS, kindClass } from "./version-format";

type VersionSwitcherProps = {
	versions: DocumentVersion[];
	/** The version on screen. */
	viewingId: string | null;
	onView: (versionId: string) => void;
	onOpenCertificate: (versionId: string) => void;
};

/**
 * The versions of a document as something to pick from. Choosing one shows it
 * in the viewer; it changes nothing about which version the document opens as.
 */
export function VersionSwitcher({ versions, viewingId, onView, onOpenCertificate }: VersionSwitcherProps) {
	if (versions.length === 0) {
		return (
			<p className="py-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				No versions yet. The first one is made when the PDF is created.
			</p>
		);
	}

	return (
		<ol className="flex flex-col gap-0.5">
			{versions.map((version) => {
				const viewing = version.id === viewingId;
				return (
					<li key={version.id} className="flex items-stretch gap-1">
						<button
							type="button"
							aria-current={viewing ? "true" : undefined}
							onClick={() => onView(version.id)}
							className={[
								"min-w-0 flex-1 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
								"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]",
								viewing ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
							].join(" ")}
						>
							<span className="flex items-center gap-2 text-[length:var(--text-dense)]">
								<span className="tabular w-6 shrink-0 text-[var(--ink-muted)]">v{version.number}</span>
								<span
									className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] ${kindClass(version.kind)}`}
								>
									{KIND_LABELS[version.kind]}
								</span>
								{version.isLatest ? (
									<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-0.5 text-[length:var(--text-micro)] font-[var(--weight-medium)] text-[var(--accent)]">
										Latest
									</span>
								) : null}
								<span className="tabular ml-auto shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
									{formatInstant(version.fileDate)}
								</span>
							</span>
							<span className="mt-0.5 block truncate pl-8 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{detailOf(version)}
							</span>
						</button>
						{version.hasCertificate ? (
							<div className="flex items-center">
								<IconAction icon="lock" label="Open the certificate" onClick={() => onOpenCertificate(version.id)} />
							</div>
						) : null}
					</li>
				);
			})}
		</ol>
	);
}
