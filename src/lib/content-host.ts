import { createContext, useContext } from "react";

/**
 * The sheet a screen is drawn on (`main` in App.tsx). Something that covers
 * the content area and nothing else, such as a file's full preview, is drawn
 * into it, so the rail and the title bar stay where they are, whichever pane
 * of whichever screen asked for it.
 */
export const ContentHostContext = createContext<HTMLElement | null>(null);

export function useContentHost(): HTMLElement | null {
	return useContext(ContentHostContext);
}
