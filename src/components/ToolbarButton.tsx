import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

type ToolbarButtonProps = {
	icon: IconName;
	label: string;
	disabled?: boolean;
	onClick: () => void;
};

/** A text button with its glyph, the size the explorer's bar holds. */
export function ToolbarButton({ icon, label, disabled = false, onClick }: ToolbarButtonProps) {
	return (
		<Button size="dense" disabled={disabled} onClick={onClick}>
			<Icon name={icon} size={14} />
			<span className="whitespace-nowrap">{label}</span>
		</Button>
	);
}
