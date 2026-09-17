import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "quiet" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
	primary: "bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]",
	quiet: "bg-transparent text-[var(--ink)] hover:bg-[var(--hover)]",
	danger: "bg-transparent text-[var(--risk)] hover:bg-[var(--risk-soft)]",
};

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
	variant?: ButtonVariant;
	/** Dense sits inside a row, base stands on its own. Both clear the hit target. */
	size?: "base" | "dense";
	children: ReactNode;
};

export function Button({
	variant = "quiet",
	size = "base",
	type = "button",
	children,
	...rest
}: ButtonProps) {
	const metrics =
		size === "dense"
			? "h-[32px] px-2 text-[length:var(--text-dense)]"
			: "h-[40px] px-4 text-[length:var(--text-base)]";

	return (
		<button
			type={type}
			{...rest}
			className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] font-[var(--weight-medium)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-50 ${metrics} ${VARIANTS[variant]}`}
		>
			{children}
		</button>
	);
}
