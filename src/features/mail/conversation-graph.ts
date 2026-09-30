export type GraphInput = {
	id: string;
	messageId: string | null;
	inReplyTo: string | null;
};

export type GraphRow = {
	id: string;
	/** 0 is the main line. A second answer to the same message opens the next lane. */
	lane: number;
	/** Index of the row this one answers, or null for the first. */
	parent: number | null;
};

export type ConversationGraph = { rows: GraphRow[]; lanes: number };

/**
 * Lays a conversation out as a graph. `nodes` are oldest first.
 *
 * A message answers the one whose Message-ID is in its In-Reply-To. It carries
 * on in its parent's lane when nothing has answered that parent yet, and opens a
 * new lane when something already did, which is what makes two replies to the
 * same mail, or one mail sent on to somebody else, read as a branch. A message
 * whose parent is not in the thread, or that answers nothing, hangs from the one
 * before it so the line is never broken.
 */
export function layoutConversation(nodes: GraphInput[]): ConversationGraph {
	const indexByMessageId = new Map<string, number>();
	const rows: GraphRow[] = [];
	const head: number[] = [];

	nodes.forEach((node, index) => {
		let parent: number | null = null;
		if (node.inReplyTo) {
			const found = indexByMessageId.get(node.inReplyTo);
			if (found !== undefined && found < index) parent = found;
		}
		if (parent === null && index > 0) parent = index - 1;

		let lane: number;
		if (parent === null) {
			lane = 0;
		} else {
			const parentLane = rows[parent]!.lane;
			lane = head[parentLane] === parent ? parentLane : head.length;
		}
		head[lane] = index;
		rows.push({ id: node.id, lane, parent });
		if (node.messageId && !indexByMessageId.has(node.messageId)) indexByMessageId.set(node.messageId, index);
	});

	return { rows, lanes: Math.max(1, head.length) };
}
