import { Icon } from "../../components/Icon";
import { toolVisual, VERBS } from "./tool-visual";

type ToolTileProps = {
	toolName: string;
	/** large sits at the head of a request, small in a row of the log. */
	size?: "large" | "small";
};

/**
 * What a tool is, as a picture: the part of Juno it works in on a tile coloured
 * by what it does, and a dot in the corner with the verb. A person scanning a
 * list of requests reads the colour first, so a removal and a send never look
 * alike.
 */
export function ToolTile({ toolName, size = "large" }: ToolTileProps) {
	const { domain, verb } = toolVisual(toolName);
	const style = VERBS[verb];
	const large = size === "large";
	return (
		<span
			title={style.label}
			className={`relative inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] ${style.tile} ${large ? "size-10" : "size-7"}`}
		>
			<Icon name={domain} size={large ? 20 : 15} />
			<span
				aria-hidden
				className={`absolute flex items-center justify-center rounded-[var(--radius-full)] ring-2 ring-[var(--surface)] ${style.dot} ${large ? "-bottom-1 -right-1 size-4" : "-bottom-1 -right-1 size-3.5"}`}
			>
				<Icon name={style.icon} size={large ? 10 : 9} />
			</span>
		</span>
	);
}
