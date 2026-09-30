import type { TemplateInput } from "@shared/types";
import { Field } from "./Field";
import { Select } from "./Select";

type TemplateInputFieldsProps = {
	inputs: TemplateInput[];
	values: Record<string, string>;
	onChange: (key: string, value: string) => void;
	/** Keys the caller has decided are missing, so they can be marked at once. */
	missing?: string[];
	disabled?: boolean;
};

/**
 * The values a template asks for, drawn from what the template declared. Both
 * the mail and the document use-a-template screens render this, so the two ask
 * for a value in the same way and neither grows its own opinion about what a
 * date field looks like.
 */
export function TemplateInputFields({
	inputs,
	values,
	onChange,
	missing = [],
	disabled = false,
}: TemplateInputFieldsProps) {
	if (inputs.length === 0) return null;

	return (
		<div className="space-y-4">
			{inputs.map((input) => (
				<TemplateInputField
					key={input.key}
					input={input}
					value={values[input.key] ?? input.defaultValue ?? ""}
					onChange={(value) => onChange(input.key, value)}
					error={missing.includes(input.key) ? "This one is needed." : null}
					disabled={disabled}
				/>
			))}
		</div>
	);
}

type TemplateInputFieldProps = {
	input: TemplateInput;
	value: string;
	onChange: (value: string) => void;
	error: string | null;
	disabled: boolean;
};

function TemplateInputField({ input, value, onChange, error, disabled }: TemplateInputFieldProps) {
	const shared = {
		label: input.label || input.key,
		value,
		onChange,
		error,
		help: input.help ?? null,
		required: input.required,
		disabled,
	};

	if (input.kind === "choice") {
		return (
			<Select
				{...shared}
				options={(input.options ?? []).map((option) => ({ value: option, label: option }))}
				placeholder={input.required ? undefined : "Leave this out"}
			/>
		);
	}

	if (input.kind === "textarea") {
		return (
			<Field
				{...shared}
				multiline
				rows={5}
			/>
		);
	}

	if (input.kind === "date") {
		return (
			<Field
				{...shared}
				type="date"
				tabular
			/>
		);
	}

	// An amount is typed, not calculated, so it stays text with a decimal
	// keypad. The service is what turns it into cents; a number input here would
	// argue with the comma a Belgian keyboard produces.
	if (input.kind === "money" || input.kind === "number") {
		return (
			<Field
				{...shared}
				inputMode="decimal"
				tabular
				placeholder={input.kind === "money" ? "0,00" : undefined}
			/>
		);
	}

	// An image and a link are both an https address typed in when the template
	// is used. The kind decides what the body does with it, not how it is asked
	// for, so both are a url field here.
	if (input.kind === "image" || input.kind === "url") {
		return <Field {...shared} type="url" placeholder="https://" />;
	}

	return <Field {...shared} />;
}
