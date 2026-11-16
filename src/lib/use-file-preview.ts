import { useEffect, useRef, useState } from "react";
import type { FilePreview, FilePreviewSource } from "@shared/types";
import { messageOf } from "./errors";

export type PreviewState =
	| { status: "loading" }
	| { status: "ready"; preview: FilePreview }
	| { status: "error"; message: string };

type Held = { key: string; state: PreviewState };

/** The part of a source that decides which file it is, so a new object for the same file does not read it again. */
export function sourceKey(source: FilePreviewSource | null): string | null {
	if (!source) return null;
	switch (source.kind) {
		case "document":
			return `document:${source.documentId}`;
		case "version":
			return `version:${source.versionId}`;
		case "attachment":
			return `attachment:${source.attachmentId}`;
		case "asset":
			return `asset:${source.assetId}`;
		case "bytes":
			return `bytes:${source.fileName}:${source.data.byteLength}:${source.fileDate ?? ""}`;
	}
}

/**
 * What a file looks like, asked of the main process (decision 76). The answer
 * is tagged with the file it belongs to, so a slow answer for the file before
 * is never shown for the one now on screen. `revision` reads the same file
 * again, for a document whose newest version just changed.
 */
export function useFilePreview(source: FilePreviewSource | null, revision = 0): PreviewState {
	const key = sourceKey(source);
	const [held, setHeld] = useState<Held | null>(null);
	const want = key === null ? null : `${key}#${revision}`;
	// The source object may be new on every render while naming the same file,
	// so the read below follows `want` and takes the source from here. This
	// effect is declared first, so it has run by the time the read does.
	const latest = useRef(source);
	useEffect(() => {
		latest.current = source;
	});

	useEffect(() => {
		const current = latest.current;
		if (!current || want === null) return;
		let cancelled = false;
		window.juno.documents
			.preview(current)
			.then((preview) => {
				if (!cancelled) setHeld({ key: want, state: { status: "ready", preview } });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setHeld({ key: want, state: { status: "error", message: messageOf(cause) } });
			});
		return () => {
			cancelled = true;
		};
	}, [want]);

	if (want === null) return { status: "loading" };
	return held && held.key === want ? held.state : { status: "loading" };
}
