import type { DocumentRecord } from "@shared/types";
import { ComposePage } from "../mail/ComposePage";
import { SignPage } from "./SignPage";

/** A page a document's menu opens in place of the screen it was started from (decision 30). */
export type DocumentTakeoverRequest = { kind: "sign" | "send"; record: DocumentRecord };

type DocumentTakeoverProps = {
	request: DocumentTakeoverRequest;
	/** Back to the screen, with a sentence to show when something happened. */
	onClose: (notice: string | null) => void;
};

/**
 * Signing or sending a document from a client's or a project's Documents tab:
 * the same sign page and composer the explorer opens, taking the screen and
 * handing it back to the record it started from.
 */
export function DocumentTakeover({ request, onClose }: DocumentTakeoverProps) {
	const { record } = request;
	if (request.kind === "sign") {
		return <SignPage record={record} onClose={() => onClose(null)} onSigned={() => onClose(`${record.title} signed.`)} />;
	}
	return (
		<ComposePage
			seed={{ clientId: record.clientId, projectId: record.projectId, documentIds: [record.id], subject: record.title }}
			onClose={() => onClose(null)}
			onDeleted={() => onClose("Draft deleted.")}
			onDone={(_message, queued) => onClose(queued ? "Message queued. Follow it in the mail outbox." : "Draft saved in the mail outbox.")}
		/>
	);
}
