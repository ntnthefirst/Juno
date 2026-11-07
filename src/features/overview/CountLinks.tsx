import type { ScreenId } from "../../app/screens";
import { requestOpen } from "../../lib/open-entity";
import { useCountUp } from "../../lib/motion";

type CountLinkProps = {
	label: string;
	/** Null while it is still being counted. */
	value: number | null;
	screen: ScreenId;
};

type CountLinksProps = {
	clients: number | null;
	projects: number | null;
	documents: number | null;
	unread: number | null;
};

function CountLink({ label, value, screen }: CountLinkProps) {
	const counted = useCountUp(value);
	return (
		<button
			type="button"
			onClick={() => requestOpen({ kind: "screen", screen })}
			className="flex items-center gap-[6px] py-1 text-base transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] hover:opacity-70"
		>
			<span className="text-ink-muted">{label}</span>
			<span className="font-[var(--weight-semibold)] tabular-nums text-ink">{counted === null ? "-" : counted}</span>
		</button>
	);
}

/**
 * Four counts set in a line of text, each one a way into its screen. The
 * numbers come from the briefing service, not from counting rows here.
 */
export function CountLinks({ clients, projects, documents, unread }: CountLinksProps) {
	return (
		<div className="flex flex-wrap gap-x-7 gap-y-1">
			<CountLink label="Clients" value={clients} screen="clients" />
			<CountLink label="Projects" value={projects} screen="projects" />
			<CountLink label="Documents" value={documents} screen="documents" />
			<CountLink label="Unread mail" value={unread} screen="mail" />
		</div>
	);
}
