import { Icon } from "./Icon";

type AddButtonProps = {
	/** What it adds, for the tooltip and for a screen reader. "New client". */
	label: string;
	disabled?: boolean;
	onClick: () => void;
};

/**
 * The plus that starts a new one of whatever the screen is listing. A screen
 * has exactly one thing it creates, and its heading already says what that is,
 * so the word on the button was saying it twice.
 *
 * Not for an empty state, where there is no list to infer from and the button
 * is the only instruction on screen. Those keep their wording.
 */
export function AddButton({ label, disabled = false, onClick }: AddButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--accent)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-50"
		>
			<Icon name="add" size={16} />
		</button>
	);
}
