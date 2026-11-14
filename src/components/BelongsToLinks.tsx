import { requestOpenClient } from "../lib/open-client";
import { requestOpen } from "../lib/open-entity";
import { RecordLink } from "./RecordLink";

type BelongsToLinksProps = {
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	/** What is said when it belongs to neither. */
	none?: string;
	tone?: "accent" | "quiet";
};

/**
 * The client and the project a record is kept under, "Client / Project", each
 * opening its own record the way every other link to it does.
 */
export function BelongsToLinks({ clientId, clientName, projectId, projectName, none = "Not linked", tone = "quiet" }: BelongsToLinksProps) {
	if (!clientName && !projectName) return <>{none}</>;
	return (
		<>
			{clientId && clientName ? (
				<RecordLink tone={tone} label={`Open ${clientName}`} onOpen={() => requestOpenClient(clientId, clientName)}>
					{clientName}
				</RecordLink>
			) : (
				clientName
			)}
			{clientName && projectName ? " / " : null}
			{projectId && projectName ? (
				<RecordLink tone={tone} label={`Open ${projectName}`} onOpen={() => requestOpen({ kind: "project", id: projectId, name: projectName })}>
					{projectName}
				</RecordLink>
			) : (
				projectName
			)}
		</>
	);
}
