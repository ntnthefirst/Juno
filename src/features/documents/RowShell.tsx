import type { HTMLAttributes, ReactNode } from "react";

type RowShellProps = HTMLAttributes<HTMLElement> & {
	/** False while the row holds a rename field, which may not sit inside a button. */
	asButton: boolean;
	ref?: (element: HTMLElement | null) => void;
	draggable?: boolean;
	children: ReactNode;
};

/**
 * The element a row or a tile of a file list is drawn as: a button, or a
 * plain element with the same role, classes and handlers while its name is
 * being edited. An input inside a button is invalid HTML, and a screen reader
 * or the keyboard can then reach neither properly.
 */
export function RowShell({ asButton, children, ...rest }: RowShellProps) {
	return asButton ? (
		<button type="button" {...rest}>
			{children}
		</button>
	) : (
		<div {...rest}>{children}</div>
	);
}
