import { Icon, type IconName } from "../components/Icon";

type TitleBarActionProps = {
	icon: IconName;
	label: string;
	/** True when pressing it opens a side panel, so that panel does not close on the press. */
	opensPanel?: boolean;
	onClick: () => void;
};

/**
 * A quiet text button with its icon, for a record's own actions in the right
 * of the title bar. It is drawn like New, which is what it stands in for.
 */
export function TitleBarAction({ icon, label, opensPanel = false, onClick }: TitleBarActionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			data-opens-panel={opensPanel ? "" : undefined}
			className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-dense font-[var(--weight-medium)] whitespace-nowrap text-[var(--ink)] transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.97]"
		>
			<Icon name={icon} size={14} strokeWidth={2} />
			{label}
		</button>
	);
}
