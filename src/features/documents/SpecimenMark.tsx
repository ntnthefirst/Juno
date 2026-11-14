/** Marks a document made from a template nobody reviewed: it is a specimen and cannot be signed. */
export function SpecimenMark() {
	return (
		<span className="inline-block shrink-0 rounded-[var(--radius-sm)] bg-[var(--risk-soft)] px-2 py-0.5 text-micro font-[var(--weight-medium)] text-[var(--risk)]">
			Specimen
		</span>
	);
}
