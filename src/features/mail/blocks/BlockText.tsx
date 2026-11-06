import type { ComposeBlockVariable } from "@shared/types";
import { splitTokens, VARIABLE_LABEL } from "./block-text";

type VariableChipProps = {
	name: ComposeBlockVariable;
};

/** A variable drawn as a chip, never as curly braces. */
export function VariableChip({ name }: VariableChipProps) {
	return (
		<span className="mx-0.5 inline-flex h-[22px] items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-1.5 align-baseline text-micro text-[var(--accent)]">
			{VARIABLE_LABEL[name]}
		</span>
	);
}

type BlockTextProps = {
	body: string;
};

/** A stored text with its variables drawn as chips and its line breaks kept. */
export function BlockText({ body }: BlockTextProps) {
	return (
		<span className="whitespace-pre-wrap">
			{splitTokens(body).map((part, index) =>
				part.kind === "text" ? (
					<span key={index}>{part.text}</span>
				) : (
					<VariableChip key={index} name={part.name} />
				),
			)}
		</span>
	);
}
