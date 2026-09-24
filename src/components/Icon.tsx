import {
	ArchiveBoxIcon,
	ArrowDownTrayIcon,
	ArrowPathIcon,
	ArrowTopRightOnSquareIcon,
	ArrowUpTrayIcon,
	ArrowUturnLeftIcon,
	ArrowUturnRightIcon,
	Bars3BottomLeftIcon,
	BellIcon,
	BuildingOffice2Icon,
	CalendarDaysIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ClipboardDocumentIcon,
	ClipboardIcon,
	ClockIcon,
	Cog6ToothIcon,
	ComputerDesktopIcon,
	DocumentDuplicateIcon,
	DocumentTextIcon,
	EllipsisHorizontalIcon,
	EnvelopeIcon,
	EnvelopeOpenIcon,
	ExclamationTriangleIcon,
	EyeIcon,
	FlagIcon,
	FunnelIcon,
	FolderIcon,
	InboxIcon,
	InformationCircleIcon,
	LinkIcon,
	LockClosedIcon,
	MagnifyingGlassIcon,
	MapPinIcon,
	MoonIcon,
	NoSymbolIcon,
	PaperAirplaneIcon,
	PaperClipIcon,
	PencilIcon,
	PencilSquareIcon,
	PhoneIcon,
	PlusIcon,
	ScissorsIcon,
	SparklesIcon,
	SunIcon,
	TrashIcon,
	UsersIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";

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
	| "info";

type HeroIcon = typeof ClockIcon;

const ICONS: Record<IconName, HeroIcon> = {
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
