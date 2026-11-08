import { useState, type ComponentProps, type ReactNode } from "react";
import { InlineInput } from "./InlineInput";

type DetailValueProps = {
	/** The value as it reads. */
	children: ReactNode;
	/** How the value is edited in place. Leave it out for one edited elsewhere (`onOpen`). */
	edit?: Omit<ComponentProps<typeof InlineInput>, "onCancel" | "onCommit"> & {
		onSave: (value: string) => Promise<void>;
	};
	/** A double click opens this instead of a field, for a value with several parts (an address). */
	onOpen?: () => void;
	/** What hovering the value offers, at its right: Make primary, remove. */
	actions?: ReactNode;
	/** The value's name for the keyboard way in, "Edit info@example.be". */
	editLabel: string;
};

/**
 * One value in the client's Details list. A double click edits it where it
 * is; hovering it shows what else can be done with it. The keyboard reaches
 * the same edit through a button that only appears when it has focus, since
 * the design draws no edit control.
 */
export function DetailValue({ children, edit, onOpen, actions, editLabel }: DetailValueProps) {
	const [editing, setEditing] = useState(false);

	if (editing && edit) {
		const { onSave, ...field } = edit;
		return (
			<div className="flex min-h-9 items-center">
				<InlineInput
					{...field}
					onCancel={() => setEditing(false)}
					onCommit={async (value) => {
						await onSave(value);
						setEditing(false);
					}}
				/>
			</div>
		);
	}

	const start = onOpen ?? (edit ? () => setEditing(true) : undefined);

	return (
		<div
			onDoubleClick={start}
			data-opens-panel={onOpen ? "" : undefined}
			className="group/value flex min-h-9 items-center gap-2 rounded-[var(--radius-sm)] px-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)]"
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
			{start ? (
				<button
					type="button"
					onClick={start}
					aria-label={editLabel}
					className="sr-only rounded-[var(--radius-md)] px-3 text-dense font-[var(--weight-medium)] focus-visible:not-sr-only focus-visible:h-8 focus-visible:flex-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					Edit
				</button>
			) : null}
			{actions ? (
				<div className="flex flex-none items-center gap-2 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease)] group-hover/value:opacity-100 focus-within:opacity-100">
					{actions}
				</div>
			) : null}
		</div>
	);
}
