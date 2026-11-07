import type { ComponentPlacement, DocumentComponent, TemplateInput } from "@shared/types";
import { passThroughKey } from "@shared/components";
import { PanelNote, PanelSection, PanelSelect, TextInput } from "./panel-controls";

const TEXT_BUTTON =
	"flex h-[28px] w-full items-center rounded-[var(--radius-sm)] px-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40";

type ComponentsSectionProps = {
	components: DocumentComponent[];
	onPlace: (componentId: string) => void;
};

/**
 * What can be placed on the page: one row for each component, which puts it at
 * the end of the page, or after what is selected.
 */
export function ComponentsSection({ components, onPlace }: ComponentsSectionProps) {
	return (
		<PanelSection title="Components">
			{components.length === 0 ? (
				<PanelNote>
					You have no components yet. Make one under Components on the Templates screen, then place it here.
				</PanelNote>
			) : (
				<div role="menu" aria-label="Place a component" className="flex flex-col rounded-[var(--radius-sm)] border border-[var(--line)] p-0.5">
					{components.map((component) => (
						<button key={component.id} type="button" role="menuitem" onClick={() => onPlace(component.id)} className={TEXT_BUTTON}>
							<span className="min-w-0 flex-1 truncate">{component.name}</span>
							<span className="flex-none text-micro text-[var(--ink-muted)]">Place</span>
						</button>
					))}
				</div>
			)}
		</PanelSection>
	);
}

type ComponentSectionProps = {
	placement: ComponentPlacement;
	/** The component itself, or null when it has been deleted. */
	component: DocumentComponent | null;
	/** What the template asks for, which a value can be passed through from. */
	inputs: TemplateInput[];
	onPlacement: (placement: ComponentPlacement) => void;
	onDetach: () => void;
	onOpen: () => void;
};

const TYPED = "";

/**
 * A placed component: which one, a value for each input it asks for, and the
 * two things that can be done with the link. A value is either typed, or one of
 * the template's own inputs passed through, so a letterhead can ask for a
 * reference number without every template declaring it by hand.
 */
export function ComponentSection({ placement, component, inputs, onPlacement, onDetach, onOpen }: ComponentSectionProps) {
	if (!component) {
		return (
			<PanelSection title="Component">
				<PanelNote tone="warn">
					This component no longer exists, so the page cannot be printed. Delete this layer.
				</PanelNote>
			</PanelSection>
		);
	}

	const setValue = (key: string, value: string) =>
		onPlacement({ ...placement, values: { ...placement.values, [key]: value } });

	return (
		<>
			<PanelSection title="Component">
				<p className="truncate text-sm text-[var(--ink)]">{component.name}</p>
				<PanelNote>
					Its content comes from the component. Changing the component changes every template that places it.
				</PanelNote>
				<button type="button" onClick={onOpen} className={TEXT_BUTTON}>
					Edit the component
				</button>
				<button type="button" onClick={onDetach} className={TEXT_BUTTON}>
					Detach from the component
				</button>
				<PanelNote>Detaching copies its content in here and drops the link.</PanelNote>
			</PanelSection>
			<PanelSection title="Values">
				{component.inputs.length === 0 ? <PanelNote>This component asks for nothing.</PanelNote> : null}
				{component.inputs.map((input) => {
					const given = placement.values[input.key] ?? "";
					const through = passThroughKey(given);
					const mode = through ? `input:${through}` : TYPED;
					return (
						<div key={input.key} className="flex flex-col gap-1">
							<span className="text-micro text-[var(--ink-muted)]">
								{input.label}
								{input.required ? "" : " (optional)"}
							</span>
							<PanelSelect
								label={`Where ${input.label} comes from`}
								value={mode}
								options={[
									{ value: TYPED, label: "Type it here" },
									...inputs.map((own) => ({ value: `input:${own.key}`, label: `Ask when the template is used: ${own.label}` })),
								]}
								onChange={(next) => setValue(input.key, next === TYPED ? "" : `{{document.${next.slice("input:".length)}}}`)}
							/>
							{through ? null : (
								<TextInput
									label={`${input.label}, typed`}
									value={given}
									placeholder={input.defaultValue ?? ""}
									multiline={input.kind === "textarea"}
									onChange={(value) => setValue(input.key, value)}
								/>
							)}
						</div>
					);
				})}
			</PanelSection>
		</>
	);
}
