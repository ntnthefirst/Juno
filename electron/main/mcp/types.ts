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
	/**
	 * The service behind this tool holds its own gate, so the generic one would
	 * ask twice for one act. `mail.send` is the only tool that sets this: it
	 * parks a draft in the outbox for a person to approve, seeing the real
	 * message rather than an argument list (decision 22).
	 *
	 * This is a statement about where the gate is, not permission to skip one.
	 * A tool that sets it without a service that refuses to act unapproved is
	 * the bug .claude/rules/mcp.md section 4 exists to prevent.
	 */
	gatedInService?: boolean;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}
