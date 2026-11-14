import { useRef } from "react";
import { Tooltip } from "./Tooltip";

type FileNameProps = {
	name: string;
	className?: string;
};

/**
 * A name that ends in an ellipsis when it does not fit, and then shows itself
 * whole in a tooltip. Only then: a tooltip repeating a name that is already
 * on screen in full is noise on every row the pointer crosses.
 *
 * Whether it is cut is measured when the pointer arrives, not as the row
 * mounts: measuring every name of a folder of five hundred forced a layout
 * per row and held Documents for half a second.
 */
export function FileName({ name, className = "" }: FileNameProps) {
	const text = useRef<HTMLSpanElement>(null);
	const whole = () => {
		const element = text.current;
		return !element || element.scrollWidth <= element.clientWidth + 1;
	};

	return (
		<Tooltip label={name} side="bottom" className="flex min-w-0" disabled={whole}>
			<span ref={text} className={`block min-w-0 truncate ${className}`}>
				{name}
			</span>
		</Tooltip>
	);
}
