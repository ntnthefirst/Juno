/**
 * The icon set, one 16px grid, one 1.5px stroke, all of it `currentColor` so it
 * follows the theme without a second definition per mode.
 *
 * Kept as one file rather than a dependency: an offline-first application that
 * pulls an icon package in is shipping a few hundred glyphs to draw fourteen,
 * and none of them would match this stroke weight anyway.
 */
export type IconName =
	| "today"
	| "clients"
	| "projects"
	| "documents"
	| "mail"
	| "calendar"
	| "reminders"
	| "agent"
	| "templates"
	| "settings"
	| "sidebar"
	| "lock"
	| "search"
	| "close";

type IconProps = {
	name: IconName;
	/** Square, in pixels. Defaults to 16, the dense-row size. */
	size?: number;
	className?: string;
};

const PATHS: Record<IconName, React.ReactNode> = {
	today: (
		<>
			<circle cx="8" cy="8" r="6" />
			<path d="M8 4.75V8l2.25 1.5" />
		</>
	),
	clients: (
		<>
			<circle cx="6.25" cy="6" r="2.5" />
			<path d="M2 13.25c0-2.07 1.9-3.5 4.25-3.5s4.25 1.43 4.25 3.5" />
			<path d="M11 3.9a2.4 2.4 0 0 1 0 4.2M12.4 13.25c0-1.3-.4-2.3-1.1-3" />
		</>
	),
	projects: (
		<>
			<path d="M2 5.25A1.25 1.25 0 0 1 3.25 4h2.4c.4 0 .78.19 1.01.51l.68.94h5.41A1.25 1.25 0 0 1 14 6.7v5.05A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z" />
		</>
	),
	documents: (
		<>
			<path d="M4 2.75h4.5L12 6.25v7A1.25 1.25 0 0 1 10.75 14.5h-6.5A1.25 1.25 0 0 1 3 13.25V4A1.25 1.25 0 0 1 4.25 2.75z" />
			<path d="M8.25 2.9v3.35H11.6" />
		</>
	),
	mail: (
		<>
			<rect x="2" y="3.75" width="12" height="8.5" rx="1.5" />
			<path d="m2.6 5 4.75 3.4a1.1 1.1 0 0 0 1.3 0L13.4 5" />
		</>
	),
	calendar: (
		<>
			<rect x="2.25" y="3.5" width="11.5" height="10.25" rx="1.5" />
			<path d="M2.25 6.75h11.5M5.5 2.25v2.5M10.5 2.25v2.5" />
		</>
	),
	reminders: (
		<>
			<path d="M4 6.75a4 4 0 0 1 8 0c0 2.4.6 3.5 1.2 4.1.3.3.1.9-.35.9H3.15c-.45 0-.65-.6-.35-.9.6-.6 1.2-1.7 1.2-4.1z" />
			<path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" />
		</>
	),
	agent: (
		<>
			<rect x="2.75" y="5" width="10.5" height="8" rx="2" />
			<path d="M8 2.25V5" />
			<circle cx="5.9" cy="8.75" r=".85" fill="currentColor" stroke="none" />
			<circle cx="10.1" cy="8.75" r=".85" fill="currentColor" stroke="none" />
		</>
	),
	templates: (
		<>
			<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5" />
			<path d="M2.25 6.25h11.5M6.25 6.25v7" />
		</>
	),
	settings: (
		<>
			<circle cx="8" cy="8" r="2.25" />
			<path d="M8 1.75l.9 1.7 1.9-.35.5 1.85 1.85.5-.35 1.9 1.7.9-1.7.9.35 1.9-1.85.5-.5 1.85-1.9-.35-.9 1.7-.9-1.7-1.9.35-.5-1.85-1.85-.5.35-1.9-1.7-.9 1.7-.9-.35-1.9 1.85-.5.5-1.85 1.9.35z" />
		</>
	),
	sidebar: (
		<>
			<rect x="2" y="3" width="12" height="10" rx="1.75" />
			<path d="M6.25 3v10" />
		</>
	),
	lock: (
		<>
			<rect x="3.25" y="7" width="9.5" height="6.75" rx="1.5" />
			<path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
		</>
	),
	search: (
		<>
			<circle cx="7.25" cy="7.25" r="4.5" />
			<path d="m10.6 10.6 2.65 2.65" />
		</>
	),
	close: <path d="m4 4 8 8M12 4l-8 8" />,
};

export function Icon({ name, size = 16, className }: IconProps) {
	return (
		<svg
			viewBox="0 0 16 16"
			width={size}
			height={size}
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
			focusable="false"
		>
			{PATHS[name]}
		</svg>
	);
}
