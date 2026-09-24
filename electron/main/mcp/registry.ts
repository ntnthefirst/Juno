/**
 * Every tool, in one list.
 *
 * The per-domain files declare; this file collects. A name that appears twice
 * throws at startup rather than shadowing quietly, because two tools with one
 * name is a mistake nothing else would report.
 */
import type { ToolSummary } from "../../shared/types";
import { agentTools } from "./agent";
import { calendarTools } from "./calendar";
import { clientAddressTools } from "./client-addresses";
import { clientEmailTools } from "./client-emails";
import { clientPhoneTools } from "./client-phones";
import { clientTimelineTools } from "./client-timeline";
import { clientTools } from "./clients";
import { contactTools } from "./contacts";
import { documentTools, templateTools } from "./documents";
import { geocodingTools } from "./geocoding";
import { mailActionTools } from "./mail-actions";
import { mailTools } from "./mail";
import { mailOutboxTools } from "./mail-outbox";
import { projectTools } from "./projects";
import { referenceTools } from "./reference";
import { reminderTools } from "./reminders";
import { searchTools } from "./search";
import { settingsTools } from "./settings";
import type { ToolDescriptor } from "./types";

const lists: ToolDescriptor[][] = [
	clientTools,
	clientTimelineTools,
	clientEmailTools,
	clientPhoneTools,
	clientAddressTools,
	contactTools,
	projectTools,
	searchTools,
	referenceTools,
	settingsTools,
	templateTools,
	documentTools,
	reminderTools,
	mailTools,
	mailActionTools,
	mailOutboxTools,
	calendarTools,
	geocodingTools,
	agentTools,
];

const byName = new Map<string, ToolDescriptor>();

for (const list of lists) {
	for (const tool of list) {
		if (byName.has(tool.name)) throw new Error(`Two tools are called "${tool.name}".`);
		byName.set(tool.name, tool);
	}
}

export function allTools(): ToolDescriptor[] {
	return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function toolByName(name: string): ToolDescriptor | null {
	return byName.get(name) ?? null;
}

/** What the settings screen lists. No handlers cross the bridge. */
export function toolSummaries(): ToolSummary[] {
	return allTools().map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: tool.description,
		readOnly: tool.readOnly,
		requiresConfirmation: tool.requiresConfirmation,
		gatedInService: tool.gatedInService === true,
	}));
}
