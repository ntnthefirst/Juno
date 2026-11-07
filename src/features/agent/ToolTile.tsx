import { Icon } from "../../components/Icon";
import { toolVisual, VERBS } from "./tool-visual";

type ToolTileProps = {
	toolName: string;
};

/**
 * What a tool is, as a picture: the part of Juno it works in, on a tile tinted
 * by what it does. A person scanning a list of requests reads the tint first,
 * so a removal and a send never look alike. The Request Card draws it plain,
 * with no badge in the corner.
 */
export function ToolTile({ toolName }: ToolTileProps) {
	const { domain, verb } = toolVisual(toolName);
	const style = VERBS[verb];
	return (
		<span
			title={style.label}
			className={`inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] ${style.tile}`}
		>
			<Icon name={domain} size={22} />
		</span>
	);
}
