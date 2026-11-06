import { useEffect } from "react";
import type { RecentKind } from "@shared/types";

/**
 * Tells the Recent list that a record is on show. Runs when the id changes and
 * says nothing while no record is open.
 */
export function useRecentTouch(kind: RecentKind, recordId: string | null): void {
	useEffect(() => {
		if (!recordId) return;
		// A list that fails to update is not worth interrupting someone who is reading.
		window.juno.recent.touch(kind, recordId).catch(() => undefined);
	}, [kind, recordId]);
}
