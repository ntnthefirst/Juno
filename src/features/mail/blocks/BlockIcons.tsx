import type { ComposeBlockKind } from "@shared/types";

type BlockIconProps = {
	kind: ComposeBlockKind;
	size?: number;
};

/**
 * A page with its first lines marked for an intro and its last lines marked
 * for an outro. Drawn in the stroke weight of the toolbar's other icons.
 */
export function BlockIcon({ kind, size = 18 }: BlockIconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<rect x="5" y="3" width="14" height="18" rx="2" />
			{kind === "intro" ? (
				<>
					<path d="M9 8h6" />
					<path d="M9 12h6" opacity="0.45" />
					<path d="M9 16h3" opacity="0.45" />
				</>
			) : (
				<>
					<path d="M9 8h3" opacity="0.45" />
					<path d="M9 12h6" opacity="0.45" />
					<path d="M9 16h6" />
				</>
			)}
		</svg>
	);
}
