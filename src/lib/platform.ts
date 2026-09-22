/**
 * Which operating system is drawing the window controls.
 *
 * Read from the user agent rather than from `app.info()`, because the title bar
 * has to reserve the right gutter on its first frame. An async answer arrives
 * after the buttons have already been painted over the interface.
 */
export const isMac = navigator.userAgent.includes("Macintosh");

/**
 * How much of the title bar the operating system owns, in pixels.
 *
 * macOS puts three traffic lights at the left. Windows and Linux put the
 * caption buttons at the right, and Electron draws them at 46px each. Anything
 * placed under them is unclickable, which looks like a broken button rather
 * than a layout mistake, so the bar keeps these gutters empty.
 */
export const overlayGutter = isMac ? { left: 78, right: 8 } : { left: 8, right: 138 };
