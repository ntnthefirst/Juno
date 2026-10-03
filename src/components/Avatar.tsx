import { initialsOf, toneClassOf } from "../lib/avatar-tone";

type AvatarProps = {
	/** A person, a business or a project. The initials and the tint both come from it. */
	name: string;
	/** Square, in pixels. Defaults to 28. */
	size?: number;
	/** Businesses and projects are squares with soft corners, people are round. */
	shape?: "round" | "square";
};

/**
 * Initials on a soft tint. There are no photographs to draw: every record here
 * is typed in by the owner, so this is what tells two rows apart when the eye
 * is going down a list.
 */
export function Avatar({ name, size = 28, shape = "round" }: AvatarProps) {
	return (
		<span
			aria-hidden
			style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
			className={[
				"inline-flex flex-none select-none items-center justify-center font-[var(--weight-semibold)] leading-none",
				shape === "round" ? "rounded-[var(--radius-full)]" : "rounded-[var(--radius-md)]",
				toneClassOf(name),
			].join(" ")}
		>
			{initialsOf(name)}
		</span>
	);
}
