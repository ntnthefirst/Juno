import type { ReactNode } from "react";

type FieldRowProps = {
	/** The grid column template, for example "1fr 1fr" or "208px 1fr 1fr". */
	columns: string;
	children: ReactNode;
};

/** Fields that sit side by side in the drawn rows of a new-record window. */
export function FieldRow({ columns, children }: FieldRowProps) {
	return (
		<div className="grid gap-4" style={{ gridTemplateColumns: columns }}>
			{children}
		</div>
	);
}
