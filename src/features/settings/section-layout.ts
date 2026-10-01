import { createContext } from "react";

/**
 * Whether the page a section is drawn on holds only that section.
 *
 * A page with one section already has a title, so a heading on the section
 * would say the same thing twice. The section keeps its description and its
 * button and drops the heading. A page with several keeps every heading, and
 * the agent screen, which is not a settings page at all, never sets this.
 *
 * It is a context rather than a prop because the sections are drawn by feature
 * components that settings does not own, several levels down.
 */
export const SoloSectionContext = createContext(false);

/**
 * The room around a page. A page that can turn into a form page draws its own
 * edges, so it takes this itself instead of being given it.
 */
export const PAGE_PADDING = "px-8 py-7";
