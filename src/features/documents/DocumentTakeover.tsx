import type { DocumentRecord } from "@shared/types";
import { ComposePage } from "../mail/ComposePage";
import { PageView } from "./PageView";
import { SignPage } from "./SignPage";
import type { DocumentTakeoverRequest } from "./takeover";

export type { DocumentTakeoverRequest } from "./takeover";

type DocumentTakeoverProps = {
	request: DocumentTakeoverRequest;
	/**
	 * Back to the screen, with a sentence to show when something happened, and
	 * the document when it was deleted here, so the screen can offer the undo.
	 */
	onClose: (notice: string | null, deleted?: DocumentRecord) => void;
	/** A page's title as it is typed, for the title bar trail. */
	onTitleChange?: (title: string) => void;
};

/**
 * Signing, sending or writing a page from a client's or a project's Documents
 * tab: the same sign page, composer and page view the documents have always
 * had, taking the screen and handing it back to the record it started from.
 */
export function DocumentTakeover({ request, onClose, onTitleChange }: DocumentTakeoverProps) {
	const { record } = request;
	if (request.kind === "sign") {
		return <SignPage record={record} onClose={() => onClose(null)} onSigned={() => onClose(`${record.title} signed.`)} />;
	}
	if (request.kind === "page") {
		return (
			<div className="h-full min-h-0">
				<PageView
					key={record.id}
					pageId={record.id}
					onDeleted={(gone) => onClose(`${gone.title} deleted.`, gone)}
					onChanged={() => undefined}
					onTitleChange={(title) => onTitleChange?.(title)}
				/>
			</div>
		);
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
