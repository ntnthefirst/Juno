import { useState, type ComponentProps, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { InlineInput } from "./InlineInput";

type DetailRowProps = {
	label: string;
	/** The row has nothing in it yet, so Add shows without a hover. */
	empty: boolean;
	children: ReactNode;
	/** "Add email" and how: an empty field in the row (`input`), or something opened elsewhere (`onOpen`). */
	add?: {
		label: string;
		input?: Omit<ComponentProps<typeof InlineInput>, "initial" | "onCancel" | "onCommit"> & {
			onCreate: (value: string) => Promise<void>;
		};
		onOpen?: () => void;
	};
};

/**
 * One kind in the client's Details list: the name in a 120px column at the
 * left, then every value of that kind. Hovering a row that holds several
 * offers one more under them; the space for it opens by its grid row, so
 * nothing is measured on the way.
 */
export function DetailRow({ label, empty, children, add }: DetailRowProps) {
	const [adding, setAdding] = useState(false);

	const start = add?.onOpen ?? (add?.input ? () => setAdding(true) : undefined);
	const addButton =
		add && start ? (
			<button
				type="button"
				onClick={start}
				data-opens-panel={add.onOpen ? "" : undefined}
				className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-dense whitespace-nowrap text-[var(--ink-muted)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				<Icon name="add" size={14} strokeWidth={2} />
				{add.label}
			</button>
		) : null;

	let foot: ReactNode = null;
	if (adding && add?.input) {
		const { onCreate, ...field } = add.input;
		foot = (
			<div className="flex min-h-9 items-center">
				<InlineInput
					{...field}
					initial=""
					onCancel={() => setAdding(false)}
					onCommit={async (value) => {
						await onCreate(value);
						setAdding(false);
					}}
				/>
			</div>
		);
	} else if (addButton && empty) {
		foot = <div className="flex min-h-9 items-center">{addButton}</div>;
	} else if (addButton) {
		foot = (
			<div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-smooth)] group-hover/row:grid-rows-[1fr] focus-within:grid-rows-[1fr]">
				<div className="min-h-0 overflow-hidden">{addButton}</div>
			</div>
		);
	}

	return (
		<div className="group/row flex gap-4 border-b border-[var(--line)] py-2">
			<div className="flex h-9 w-[120px] flex-none items-center text-base text-[var(--ink-muted)]">{label}</div>
			<div className="min-w-0 flex-1">
				{children}
				{foot}
			</div>
		</div>
	);
}
