import {
	ArchiveBoxIcon,
	ArrowDownTrayIcon,
	ArrowPathIcon,
	ArrowTopRightOnSquareIcon,
	ArrowUpIcon,
	ArrowUpTrayIcon,
	ArrowUturnLeftIcon,
	ArrowUturnRightIcon,
	ArrowDownIcon,
	ArrowRightIcon,
	ArrowsPointingOutIcon,
	ArrowsUpDownIcon,
	Bars3BottomLeftIcon,
	Bars3BottomRightIcon,
	Bars3Icon,
	Bars4Icon,
	BellIcon,
	BoldIcon,
	BookOpenIcon,
	BuildingOffice2Icon,
	CalendarDaysIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ClipboardDocumentIcon,
	ClipboardIcon,
	ClockIcon,
	CodeBracketIcon,
	Cog6ToothIcon,
	CursorArrowRaysIcon,
	DevicePhoneMobileIcon,
	DeviceTabletIcon,
	CommandLineIcon,
	ComputerDesktopIcon,
	CubeIcon,
	DocumentDuplicateIcon,
	DocumentTextIcon,
	EllipsisHorizontalIcon,
	EnvelopeIcon,
	EnvelopeOpenIcon,
	ExclamationTriangleIcon,
	EyeIcon,
	EyeSlashIcon,
	FlagIcon,
	FunnelIcon,
	FolderIcon,
	H1Icon,
	H2Icon,
	H3Icon,
	HashtagIcon,
	FolderOpenIcon,
	GlobeAltIcon,
	InboxIcon,
	InformationCircleIcon,
	ItalicIcon,
	LinkIcon,
	ListBulletIcon,
	LockClosedIcon,
	MagnifyingGlassIcon,
	MapPinIcon,
	MinusIcon,
	MoonIcon,
	NoSymbolIcon,
	PaintBrushIcon,
	PaperAirplaneIcon,
	PaperClipIcon,
	PencilIcon,
	PencilSquareIcon,
	PhoneIcon,
	PhotoIcon,
	PlayIcon,
	PlusIcon,
	ScissorsIcon,
	SparklesIcon,
	Squares2X2Icon,
	StarIcon,
	StopIcon,
	StrikethroughIcon,
	SunIcon,
	SwatchIcon,
	TrashIcon,
	UnderlineIcon,
	UsersIcon,
	VariableIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode } from "react";

/**
 * The icon set, named for what it means here rather than for what the drawing
 * is. A screen asks for "clients", not for a pair of people, so the day one of
 * these is redrawn nothing outside this file changes.
 *
 * Heroicons supplies the drawings. They are on a 24px grid with a 1.5 stroke,
 * which lands at a hairline once scaled to the 16px this interface uses, so the
 * stroke is set back up here to hold its weight at that size. Only the icons
 * named below are imported, so the rest of the set is not bundled.
 */
export type IconName =
	| "today"
	| "clients"
	| "client"
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
	| "close"
	| "check"
	| "light"
	| "dark"
	| "system"
	| "more"
	| "add"
	| "edit"
	| "note"
	| "remove"
	| "archive"
	| "link"
	| "flag"
	| "filter"
	| "read"
	| "unread"
	| "reply"
	| "forward"
	| "attachment"
	| "inbox"
	| "sent"
	| "drafts"
	| "junk"
	| "sync"
	| "import"
	| "export"
	| "phone"
	| "address"
	| "chevron-down"
	| "chevron-left"
	| "chevron-right"
	| "external"
	| "copy"
	| "cut"
	| "paste"
	| "warning"
	| "info"
	| "play"
	| "stop"
	| "terminal"
	| "container"
	| "repo"
	| "figma"
	| "design"
	| "web"
	| "docs"
	| "folder-open"
	| "image"
	| "star"
	| "grid"
	| "list"
	| "rows"
	| "move-up"
	| "move-down"
	| "move-right"
	| "visible"
	| "hidden"
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "align-left"
	| "align-center"
	| "align-right"
	| "align-justify"
	| "corners"
	// The mail template canvas: its tools, its views and its design panel.
	| "tool-section"
	| "tool-text"
	| "tool-heading"
	| "tool-button"
	| "tool-input"
	| "tool-divider"
	| "tool-spacer"
	| "view-canvas"
	| "view-code"
	| "device-desktop"
	| "device-tablet"
	| "device-phone"
	| "h1"
	| "h2"
	| "h3"
	| "self-h-start"
	| "self-h-center"
	| "self-h-end"
	| "self-h-stretch"
	| "self-v-start"
	| "self-v-center"
	| "self-v-end"
	| "self-v-stretch"
	| "size-fixed"
	| "size-hug"
	| "size-fill"
	| "justify-start"
	| "justify-center"
	| "justify-end"
	| "justify-between"
	| "justify-around"
	| "text-top"
	| "text-middle"
	| "text-bottom"
	| "fill-solid"
	| "fill-gradient"
	| "stroke-solid"
	| "stroke-dashed"
	| "stroke-dotted"
	| "effect-drop"
	| "effect-inner"
	| "effect-blur"
	| "wrap"
	| "keyboard"
	| "minus";

type GlyphProps = {
	width?: number;
	height?: number;
	className?: string;
	strokeWidth?: number;
	"aria-hidden"?: boolean;
	focusable?: "false" | "true";
};

type Glyph = ComponentType<GlyphProps>;

/**
 * A drawing in the same grid and stroke as the heroicons around it, for the
 * few things the set has no picture of: Figma's alignment, resizing and
 * distribution marks, line styles and effects. Outline, 24 units, round caps,
 * current colour, so nothing about it can be told apart from the rest.
 */
function glyph(paths: ReactNode): Glyph {
	function Drawn({ width, height, className, strokeWidth, focusable, ...rest }: GlyphProps) {
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
				width={width}
				height={height}
				className={className}
				focusable={focusable}
				aria-hidden={rest["aria-hidden"]}
			>
				{paths}
			</svg>
		);
	}
	return Drawn;
}

const DRAWN = {
	text: glyph(<path d="M5 6.5V5h14v1.5M12 5v14m-2.5 0h5" />),
	button: glyph(
		<>
			<rect x="3" y="7" width="18" height="10" rx="3" />
			<path d="M8.5 12h7" />
		</>,
	),
	selfHStart: glyph(
		<>
			<path d="M4 4v16" />
			<rect x="7" y="6.5" width="12" height="4" rx="1" />
			<rect x="7" y="13.5" width="7" height="4" rx="1" />
		</>,
	),
	selfHCenter: glyph(
		<>
			<path d="M12 4v2.5m0 4v3m0 4V20" />
			<rect x="5" y="6.5" width="14" height="4" rx="1" />
			<rect x="8" y="13.5" width="8" height="4" rx="1" />
		</>,
	),
	selfHEnd: glyph(
		<>
			<path d="M20 4v16" />
			<rect x="5" y="6.5" width="12" height="4" rx="1" />
			<rect x="10" y="13.5" width="7" height="4" rx="1" />
		</>,
	),
	selfHStretch: glyph(
		<>
			<path d="M4 4v16M20 4v16" />
			<rect x="7" y="9" width="10" height="6" rx="1" />
		</>,
	),
	selfVStart: glyph(
		<>
			<path d="M4 4h16" />
			<rect x="6.5" y="7" width="4" height="12" rx="1" />
			<rect x="13.5" y="7" width="4" height="7" rx="1" />
		</>,
	),
	selfVCenter: glyph(
		<>
			<path d="M4 12h2.5m4 0h3m4 0H20" />
			<rect x="6.5" y="5" width="4" height="14" rx="1" />
			<rect x="13.5" y="8" width="4" height="8" rx="1" />
		</>,
	),
	selfVEnd: glyph(
		<>
			<path d="M4 20h16" />
			<rect x="6.5" y="5" width="4" height="12" rx="1" />
			<rect x="13.5" y="10" width="4" height="7" rx="1" />
		</>,
	),
	selfVStretch: glyph(
		<>
			<path d="M4 4h16M4 20h16" />
			<rect x="9" y="7" width="6" height="10" rx="1" />
		</>,
	),
	sizeFixed: glyph(<path d="M4 8v8M20 8v8M4 12h16" />),
	sizeHug: glyph(<path d="M3 12h5m-2-2.5L8.5 12 6 14.5M21 12h-5m2-2.5L15.5 12l2.5 2.5M12 7v10" />),
	sizeFill: glyph(<path d="M4 7v10M20 7v10M8 12h8m-6-2.5L7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" />),
	justifyStart: glyph(
		<>
			<path d="M4 4v16" />
			<rect x="6.5" y="8" width="4" height="8" rx="1" />
			<rect x="12" y="8" width="4" height="8" rx="1" />
		</>,
	),
	justifyCenter: glyph(
		<>
			<path d="M12 4v2m0 12v2" />
			<rect x="6.5" y="8" width="4" height="8" rx="1" />
			<rect x="13.5" y="8" width="4" height="8" rx="1" />
		</>,
	),
	justifyEnd: glyph(
		<>
			<path d="M20 4v16" />
			<rect x="8" y="8" width="4" height="8" rx="1" />
			<rect x="13.5" y="8" width="4" height="8" rx="1" />
		</>,
	),
	justifyBetween: glyph(
		<>
			<path d="M4 4v16M20 4v16" />
			<rect x="6" y="8" width="4" height="8" rx="1" />
			<rect x="14" y="8" width="4" height="8" rx="1" />
		</>,
	),
	justifyAround: glyph(
		<>
			<path d="M4 4v16M20 4v16" />
			<rect x="7.5" y="8" width="3.5" height="8" rx="1" />
			<rect x="13" y="8" width="3.5" height="8" rx="1" />
		</>,
	),
	textTop: glyph(<path d="M5 4h14M12 20V8m-3.5 3.5L12 8l3.5 3.5" />),
	textMiddle: glyph(<path d="M5 12h14M12 3v5M9.5 5.5 12 8l2.5-2.5M12 21v-5m-2.5 2.5L12 16l2.5 2.5" />),
	textBottom: glyph(<path d="M5 20h14M12 4v12m-3.5-3.5L12 16l3.5-3.5" />),
	fillSolid: glyph(<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" />),
	fillGradient: glyph(
		<>
			<rect x="4" y="4" width="16" height="16" rx="3" />
			<path d="M9 4.5v15" strokeOpacity="0.9" />
			<path d="M13 4.5v15" strokeOpacity="0.6" />
			<path d="M17 4.5v15" strokeOpacity="0.3" />
		</>,
	),
	strokeSolid: glyph(<path d="M4 12h16" />),
	strokeDashed: glyph(<path d="M4 12h3.5m3 0h3m3 0H20" />),
	strokeDotted: glyph(
		<>
			<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="9.7" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="14.3" cy="12" r="1.2" fill="currentColor" stroke="none" />
			<circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
		</>,
	),
	effectDrop: glyph(
		<>
			<rect x="4" y="4" width="13" height="13" rx="2" />
			<path d="M20 8v10a2 2 0 0 1-2 2H8" />
		</>,
	),
	effectInner: glyph(
		<>
			<rect x="4" y="4" width="16" height="16" rx="2" />
			<path d="M7.5 16.5V9.5a2 2 0 0 1 2-2h7" />
		</>,
	),
	effectBlur: glyph(
		<>
			<circle cx="12" cy="12" r="4" />
			<circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
		</>,
	),
	wrap: glyph(<path d="M4 7h12.5a3 3 0 0 1 0 6H9m2.5-2.5L9 13l2.5 2.5M4 17h4" />),
	keyboard: glyph(
		<>
			<rect x="2.5" y="6" width="19" height="12" rx="2" />
			<path d="M6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M17.5 10h.01M7.5 12.5h.01M10.5 12.5h.01M13.5 12.5h.01M16.5 12.5h.01M8 15h8" />
		</>,
	),
};

const ICONS: Record<IconName, Glyph> = {
	today: ClockIcon,
	clients: UsersIcon,
	client: BuildingOffice2Icon,
	projects: FolderIcon,
	documents: DocumentTextIcon,
	mail: EnvelopeIcon,
	calendar: CalendarDaysIcon,
	reminders: BellIcon,
	agent: SparklesIcon,
	templates: DocumentDuplicateIcon,
	settings: Cog6ToothIcon,
	// A panel with its left column filled. Heroicons has no sidebar glyph, and
	// this reads as "the thing on the left" better than a plain hamburger.
	sidebar: Bars3BottomLeftIcon,
	lock: LockClosedIcon,
	search: MagnifyingGlassIcon,
	close: XMarkIcon,
	check: CheckIcon,
	light: SunIcon,
	dark: MoonIcon,
	system: ComputerDesktopIcon,
	// Horizontal rather than vertical: the button it sits in is wider than it is
	// tall everywhere it is used, and three dots across read as "a menu" where
	// three dots down read as a drag handle.
	more: EllipsisHorizontalIcon,
	add: PlusIcon,
	edit: PencilIcon,
	note: PencilSquareIcon,
	remove: TrashIcon,
	archive: ArchiveBoxIcon,
	link: LinkIcon,
	flag: FlagIcon,
	filter: FunnelIcon,
	read: EnvelopeOpenIcon,
	unread: EyeIcon,
	reply: ArrowUturnLeftIcon,
	forward: ArrowUturnRightIcon,
	attachment: PaperClipIcon,
	inbox: InboxIcon,
	sent: PaperAirplaneIcon,
	drafts: PencilSquareIcon,
	junk: NoSymbolIcon,
	sync: ArrowPathIcon,
	import: ArrowUpTrayIcon,
	export: ArrowDownTrayIcon,
	phone: PhoneIcon,
	address: MapPinIcon,
	"chevron-down": ChevronDownIcon,
	"chevron-left": ChevronLeftIcon,
	"chevron-right": ChevronRightIcon,
	external: ArrowTopRightOnSquareIcon,
	copy: ClipboardDocumentIcon,
	cut: ScissorsIcon,
	paste: ClipboardIcon,
	warning: ExclamationTriangleIcon,
	info: InformationCircleIcon,
	play: PlayIcon,
	stop: StopIcon,
	terminal: CommandLineIcon,
	// Docker. There is no container glyph in the set and a box is what everyone
	// draws for one anyway.
	container: CubeIcon,
	repo: CodeBracketIcon,
	// Figma has no mark here and would not be ours to draw. A swatch is what the
	// link is: somewhere the design lives.
	figma: SwatchIcon,
	design: PaintBrushIcon,
	web: GlobeAltIcon,
	docs: BookOpenIcon,
	"folder-open": FolderOpenIcon,
	image: PhotoIcon,
	star: StarIcon,
	grid: Squares2X2Icon,
	list: ListBulletIcon,
	// Wider bars than the list glyph: rows carry a thumbnail and a line of text,
	// where the list is one line each.
	rows: Bars4Icon,
	"move-up": ArrowUpIcon,
	"move-down": ArrowDownIcon,
	"move-right": ArrowRightIcon,
	// The layer controls and the type panel on the mail template canvas.
	visible: EyeIcon,
	hidden: EyeSlashIcon,
	bold: BoldIcon,
	italic: ItalicIcon,
	underline: UnderlineIcon,
	strike: StrikethroughIcon,
	"align-left": Bars3BottomLeftIcon,
	"align-center": Bars3Icon,
	"align-right": Bars3BottomRightIcon,
	"align-justify": Bars4Icon,
	corners: ArrowsPointingOutIcon,
	"tool-section": HashtagIcon,
	"tool-text": DRAWN.text,
	"tool-heading": H2Icon,
	"tool-button": DRAWN.button,
	"tool-input": VariableIcon,
	"tool-divider": MinusIcon,
	"tool-spacer": ArrowsUpDownIcon,
	"view-canvas": CursorArrowRaysIcon,
	"view-code": CodeBracketIcon,
	"device-desktop": ComputerDesktopIcon,
	"device-tablet": DeviceTabletIcon,
	"device-phone": DevicePhoneMobileIcon,
	h1: H1Icon,
	h2: H2Icon,
	h3: H3Icon,
	"self-h-start": DRAWN.selfHStart,
	"self-h-center": DRAWN.selfHCenter,
	"self-h-end": DRAWN.selfHEnd,
	"self-h-stretch": DRAWN.selfHStretch,
	"self-v-start": DRAWN.selfVStart,
	"self-v-center": DRAWN.selfVCenter,
	"self-v-end": DRAWN.selfVEnd,
	"self-v-stretch": DRAWN.selfVStretch,
	"size-fixed": DRAWN.sizeFixed,
	"size-hug": DRAWN.sizeHug,
	"size-fill": DRAWN.sizeFill,
	"justify-start": DRAWN.justifyStart,
	"justify-center": DRAWN.justifyCenter,
	"justify-end": DRAWN.justifyEnd,
	"justify-between": DRAWN.justifyBetween,
	"justify-around": DRAWN.justifyAround,
	"text-top": DRAWN.textTop,
	"text-middle": DRAWN.textMiddle,
	"text-bottom": DRAWN.textBottom,
	"fill-solid": DRAWN.fillSolid,
	"fill-gradient": DRAWN.fillGradient,
	"stroke-solid": DRAWN.strokeSolid,
	"stroke-dashed": DRAWN.strokeDashed,
	"stroke-dotted": DRAWN.strokeDotted,
	"effect-drop": DRAWN.effectDrop,
	"effect-inner": DRAWN.effectInner,
	"effect-blur": DRAWN.effectBlur,
	wrap: DRAWN.wrap,
	keyboard: DRAWN.keyboard,
	minus: MinusIcon,
};

type IconProps = {
	name: IconName;
	/** Square, in pixels. Defaults to 16, the dense-row size. */
	size?: number;
	className?: string;
};

export function Icon({ name, size = 16, className }: IconProps) {
	const Glyph = ICONS[name];
	return (
		<Glyph
			width={size}
			height={size}
			className={className}
			// 1.5 on a 24 grid is 1.0 once drawn at 16, which reads as grey next to
			// 14px text. This keeps the stroke roughly where the type weight is.
			strokeWidth={size <= 20 ? 1.8 : 1.5}
			aria-hidden
			focusable="false"
		/>
	);
}
