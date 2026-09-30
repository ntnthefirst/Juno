import { useLayoutEffect, useRef, useState } from "react";

type FitTextProps = {
	text: string;
	/** The size it is drawn at when it fits, in CSS pixels. */
	size: number;
	/** The width it has to stay inside, in CSS pixels. */
	available: number;
};

/**
 * A line of text that shrinks to fit rather than being cut off. The PDF writer
 * does the same to a long name, so it reads in full in both places.
 */
export function FitText({ text, size, available }: FitTextProps) {
	const element = useRef<HTMLSpanElement>(null);
	const [scale, setScale] = useState(1);

	useLayoutEffect(() => {
		const target = element.current;
		if (!target || available <= 0) return;
		// Measured at full size, so the answer does not depend on the last scale.
		target.style.fontSize = `${size}px`;
		const width = target.scrollWidth;
		setScale(width > available ? available / width : 1);
	}, [text, size, available]);

	return (
		<span ref={element} className="inline-block" style={{ fontSize: size * scale }}>
			{text}
		</span>
	);
}
