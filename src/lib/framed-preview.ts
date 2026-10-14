import { withoutRemoteImages } from "./remote-image";

/**
 * A rendered message as a preview frame in this window can show it.
 *
 * The message links its fonts in its head, and a frame in Juno's window is
 * under the window's own content policy, which loads no stylesheet from
 * anywhere but Juno. So the links come out, which also keeps the refusal out
 * of the console, and the faces the editor already loaded go in. A Google font
 * then shows the way the recipient's client will show it; a font linked from
 * anywhere else shows its fallback, the same as on the canvas.
 *
 * Pictures at a web address are treated the same way: the window loads no
 * image but its own, so each becomes a box saying the reader's mail client
 * loads it (remote-image.ts), unless the person confirmed the source and Juno
 * downloaded it (`loaded`, from remote-pictures.ts). What is sent is untouched.
 */
export function framed(html: string, fontCss: string, loaded: Record<string, string> = {}): string {
	const unlinked = withoutRemoteImages(html, loaded).replace(/<link rel="stylesheet" href="[^"]*">/g, "");
	return fontCss ? unlinked.replace("</head>", `<style>${fontCss}</style></head>`) : unlinked;
}
