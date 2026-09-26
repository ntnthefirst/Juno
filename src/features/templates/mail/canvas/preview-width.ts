/**
 * The three widths a message is read at.
 *
 * They are a way of looking, not a property of the template: the compiled body
 * carries `max-width`, so narrowing the frame is what a phone actually does to
 * it. Changing the frame's own width is a control in the design panel, and it
 * is a different thing.
 */
export type PreviewWidth = "wide" | "medium" | "small";

export const PREVIEW_WIDTHS: Record<PreviewWidth, number> = { wide: 600, medium: 480, small: 320 };
