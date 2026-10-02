export interface ToolDescriptor {
	name: string;
	title: string;
	description: string;
	readOnly: boolean;
	/**
	 * A person approves each call before it runs. The gate is generic and lives
	 * in services/agent-actions.ts; the host parks the call there and hands the
	 * caller back a pending action instead of a result.
	 */
	requiresConfirmation: boolean;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
	/**
	 * For a confirmed tool whose arguments do not say enough to approve: what a
	 * person should read first, built when the call is made and before it is
	 * parked. `mail.send` takes a draft's id, so this is where the whole message
	 * is put in front of them. It also refuses a call that could never run, so
	 * the agent learns that at once instead of leaving a dead request waiting.
	 */
	prepare?: (args: Record<string, unknown>) => Promise<ToolPreparation>;
	/**
	 * Runs when a person approves, before the handler, with the seal `prepare`
	 * made. Throws when what was approved is no longer what would run.
	 */
	verify?: (args: Record<string, unknown>, seal: string | null) => Promise<void>;
}

export interface ToolPreparation {
	/** Replaces the generic one-line summary. */
	summary?: string;
	/** The full text a person reads before approving. */
	preview: string;
	/** A fingerprint of what the preview was built from. */
	seal?: string;
}
