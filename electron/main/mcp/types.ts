export interface ToolDescriptor {
	name: string;
	title: string;
	description: string;
	readOnly: boolean;
	requiresConfirmation: boolean;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}
