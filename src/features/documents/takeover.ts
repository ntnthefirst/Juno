import type { DocumentRecord } from "@shared/types";

/** A page a document's menu opens in place of the screen it was started from (decision 30). */
export type DocumentTakeoverRequest = { kind: "sign" | "send" | "page"; record: DocumentRecord };

/** The trail's last step for a takeover: what is being done to which document. */
export function takeoverLabel(request: DocumentTakeoverRequest): string {
	if (request.kind === "sign") return `Sign ${request.record.title}`;
	if (request.kind === "send") return "New message";
	return request.record.title;
}
