import { useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

type FileNameProps = {
	name: string;
	className?: string;
};

/**
 * A name that ends in an ellipsis when it does not fit, and then shows itself
 * whole in a tooltip. Only then: a tooltip repeating a name that is already
 * on screen in full is noise on every row the pointer crosses.
 */
export function FileName({ name, className = "" }: FileNameProps) {
	const text = useRef<HTMLSpanElement>(null);
	const [cut, setCut] = useState(false);

	useLayoutEffect(() => {
		const element = text.current;
		if (!element) return;
		const measure = () => setCut(element.scrollWidth > element.clientWidth + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [name]);

	return (
		<Tooltip label={name} side="bottom" className="flex min-w-0" disabled={!cut}>
			<span ref={text} className={`block min-w-0 truncate ${className}`}>
				{name}
			</span>
		</Tooltip>
	);
}
