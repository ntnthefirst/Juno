import { useId } from "react";
import type { TemplateInput } from "@shared/types";
import { Button } from "./Button";
import { Field } from "./Field";
import { Select } from "./Select";

type TemplateInputFieldsProps = {
	inputs: TemplateInput[];
	values: Record<string, string>;
	onChange: (key: string, value: string) => void;
	/** Keys the caller has decided are missing, so they can be marked at once. */
	missing?: string[];
	disabled?: boolean;
	/**
	 * A picture is a file chosen here rather than an address, for a document,
	 * which prints the picture itself. The value is then the picture's bytes
	 * as a `data:` address.
	 */
	pictureFiles?: boolean;
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
	pictureFiles = false,
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
					pictureFiles={pictureFiles}
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
	pictureFiles: boolean;
};

function TemplateInputField({ input, value, onChange, error, disabled, pictureFiles }: TemplateInputFieldProps) {
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

	if (input.kind === "image" && pictureFiles) {
		return <PictureField {...shared} />;
	}

	// An image and a link are both an https address typed in when the template
	// is used. The kind decides what the body does with it, not how it is asked
	// for, so both are a url field here.
	if (input.kind === "image" || input.kind === "url") {
		return <Field {...shared} type="url" placeholder="https://" />;
	}

	return <Field {...shared} />;
}

type PictureFieldProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	error: string | null;
	help: string | null;
	required: boolean;
	disabled: boolean;
};

/**
 * A picture chosen from a file, read into a `data:` address in the window. The
 * bytes go to the main process with the other values and are checked there;
 * nothing here names a path.
 */
function PictureField({ label, value, onChange, error, help, required, disabled }: PictureFieldProps) {
	const id = useId();
	const chosen = value.startsWith("data:image/");
	return (
		<div>
			<label htmlFor={id} className="block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink)]">
				{label}
				{required ? <span className="text-[var(--ink-muted)]"> (required)</span> : null}
			</label>
			<div className="mt-1.5 flex items-center gap-3">
				{chosen ? (
					<img
						src={value}
						alt=""
						className="h-[48px] w-[48px] flex-none rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] object-contain"
					/>
				) : null}
				<input
					id={id}
					type="file"
					accept="image/png,image/jpeg,image/gif,image/webp"
					disabled={disabled}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (!file) return;
						const reader = new FileReader();
						reader.onload = () => {
							if (typeof reader.result === "string") onChange(reader.result);
						};
						reader.readAsDataURL(file);
					}}
					className="min-w-0 flex-1 text-[length:var(--text-sm)] text-[var(--ink-muted)] file:mr-3 file:h-[32px] file:rounded-[var(--radius-md)] file:border file:border-[var(--line)] file:bg-[var(--surface)] file:px-3 file:text-[var(--ink)]"
				/>
				{chosen ? (
					<Button size="dense" disabled={disabled} onClick={() => onChange("")}>
						Remove
					</Button>
				) : null}
			</div>
			{help ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{help}</p> : null}
			{error ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">{error}</p> : null}
		</div>
	);
}
