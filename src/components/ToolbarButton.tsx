import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

type ToolbarButtonProps = {
	icon: IconName;
	label: string;
	disabled?: boolean;
	onClick: () => void;
};

/** A quiet text button with its glyph, the size a Documents tab's bar and the Templates bar hold. */
export function ToolbarButton({ icon, label, disabled = false, onClick }: ToolbarButtonProps) {
	return (
		<Button size="dense" disabled={disabled} onClick={onClick}>
			<Icon name={icon} size={14} />
			<span className="whitespace-nowrap">{label}</span>
		</Button>
	);
}
