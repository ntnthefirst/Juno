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
}
