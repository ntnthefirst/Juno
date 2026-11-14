import { useEffect, useRef } from "react";

type RenameFieldProps = {
	value: string;
	onCommit: (name: string) => void;
	onCancel: () => void;
};

/**
 * A name edited where it is drawn, as F2 does in a file manager: the whole
 * name selected, Enter or a click elsewhere keeps it, Escape puts it back.
 * Every key stops here, so the list's own keys (Delete, Space, the arrows)
 * edit the text instead of the files. Enter and Escape hand the focus back
 * to the row, as a file manager does, so the keys carry on from it.
 */
export function RenameField({ value, onCommit, onCancel }: RenameFieldProps) {
	const input = useRef<HTMLInputElement>(null);
	const settled = useRef(false);

	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	/** The row the field sits in, focused again once the field is gone. */
	function refocusRow() {
		const row = input.current?.closest<HTMLElement>("[data-explorer-item], [data-tree-node]");
		window.requestAnimationFrame(() => {
			if (row?.isConnected) row.focus({ preventScroll: true });
		});
	}

	function commit() {
		if (settled.current) return;
		settled.current = true;
		const next = input.current?.value.trim() ?? "";
		if (next.length === 0 || next === value) onCancel();
		else onCommit(next);
	}

	return (
		<input
			ref={input}
			defaultValue={value}
			aria-label="Name"
			onClick={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					refocusRow();
					commit();
				} else if (event.key === "Escape") {
					event.preventDefault();
					settled.current = true;
					refocusRow();
					onCancel();
				}
			}}
			onBlur={commit}
			className="h-[28px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--focus)] bg-[var(--surface)] px-2 text-dense text-[var(--ink)] outline-none"
		/>
	);
}
