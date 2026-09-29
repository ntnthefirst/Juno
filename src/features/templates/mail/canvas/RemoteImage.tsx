import { Icon } from "../../../../components/Icon";
import { REMOTE_IMAGE_NOTE } from "./remote-image";

type RemoteImageProps = {
	alt: string;
	/** Pixels, or null for the whole width it is given. */
	width: number | null;
};

/**
 * Where a picture at a web address goes on the canvas. The window loads no
 * image from anywhere but Juno, so this is a box at the picture's width with
 * its alt text, and a line saying the reader's mail client does the loading.
 */
export function RemoteImage({ alt, width }: RemoteImageProps) {
	return (
		<span
			className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--canvas-line)] bg-[var(--canvas-paper)] p-2 text-[length:var(--text-micro)] leading-[var(--leading-tight)] text-[var(--canvas-ink-muted)]"
			style={{ boxSizing: "border-box", maxWidth: "100%", width: width ?? undefined }}
		>
			<span className="flex items-center gap-1.5 text-[var(--canvas-ink)]">
				<Icon name="image" size={14} /> {alt || "Picture"}
			</span>
			<span>{REMOTE_IMAGE_NOTE}</span>
		</span>
	);
}
