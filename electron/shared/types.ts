/**
 * The shapes that cross the preload bridge, shared by the main process and the
 * renderer. Both sides import from here so a change breaks the typecheck rather
 * than showing up at runtime.
 *
 * Rules that apply to everything in this file:
 * - Timestamps are UTC ISO-8601 strings. Never a Date object: a Date survives
 *   structured clone but not the JSON serialisation the MCP adapter uses, so the
 *   two callers would see different things (see .claude/rules/verify.md).
 * - Money is integer cents, never a float and never a decimal string.
 * - Calendar dates with no time are `YYYY-MM-DD`, not a UTC instant.
 * - Nothing here ever carries a credential.
 */

export type Iso = string;
export type IsoDate = string;
export type Cents = number;

/** Every row Juno stores carries these. See decision 4. */
export interface Standard {
	id: string;
	ownerId: string;
	createdAt: Iso;
	updatedAt: Iso;
	deletedAt: Iso | null;
}

/* --------------------------------------------------------- client timeline */

/**
 * Something the user wrote down about a client, usually because it left no
 * other trace. A phone call is the case this exists for.
 */
export interface ClientNote extends Standard {
	clientId: string;
	/** When it happened, which is not when it was typed in. */
	happenedAt: Iso;
	kind: ClientNoteKind;
	title: string;
	body: string | null;
}

export type ClientNoteKind = "note" | "call" | "meeting";

export interface ClientNoteInput {
	clientId: string;
	title: string;
	/** Defaults to now. */
	happenedAt?: Iso;
	kind?: ClientNoteKind;
	body?: string | null;
}

export interface ClientNotePatch {
	happenedAt?: Iso;
	kind?: ClientNoteKind;
	title?: string;
	body?: string | null;
}

export type ClientTimelineKind = "note" | "mail" | "document" | "event" | "reminder" | "project" | "status";

/**
 * One line in a client's history, whichever table it came from.
 *
 * `at` is always an instant and is what the stream sorts on. `on` is set
 * instead when the underlying record is a date with no time: a deadline, a
 * reminder, an all-day appointment. The interface shows `on` when it is there
 * and never converts it, because midnight UTC is the day before in Brussels for
 * half the year and a deadline that moves is the bug that appears twice a year.
 */
export interface ClientTimelineEntry {
	/** Unique across sources: the kind and the row id, so a list key is safe. */
	id: string;
	kind: ClientTimelineKind;
	at: Iso;
	on: IsoDate | null;
	title: string;
	/** One line under the title, already in words. */
	detail: string | null;
	/** The row this came from, so the interface can open it. */
	entityId: string;
	/**
	 * A note's own kind, or a reminder's category, or null. It picks an icon
	 * and nothing else, so a value nothing recognises is safe to ignore.
	 */
	variant: string | null;
	/**
	 * Set only on a "status" entry: both ends of the change, resolved to a
	 * label and a tone at read time, hidden or not (.claude/rules/data.md
	 * section 9). Null is "no status", which is a status a client can move to
	 * or from. `title` already spells the change out in words, for anything
	 * that reads the timeline as plain text; this is what lets the interface
	 * colour just the two names.
	 */
	statusChange?: {
		from: ClientTimelineStatusName | null;
		to: ClientTimelineStatusName | null;
	};
}

export interface ClientTimelineStatusName {
	label: string;
	/** A token name from brand/tokens.css, never a hex value. See StatusBadge. */
	tone: string | null;
}

export interface ClientTimelineQuery {
	clientId: string;
	/** Left out means every kind. */
	kinds?: ClientTimelineKind[];
	limit?: number;
	/** Only entries older than this, for the next page. */
	before?: Iso;
}

/* ------------------------------------------------------------------ clients */

export interface Client extends Standard {
	name: string;
	sortName: string;
	statusId: string | null;
	website: string | null;
	vatNumber: string | null;
	/** Free text, Markdown. Rendered the way a calendar event's notes are. */
	notes: string | null;
}

/** What a list row needs, resolved, so the renderer does not join by hand. */
export interface ClientSummary {
	id: string;
	name: string;
	status: ReferenceItem | null;
	/** The primary address's city, if there is one. */
	city: string | null;
	/** The primary email, if there is one. */
	email: string | null;
	projectCount: number;
	openProjectCount: number;
}

export type ClientInput = Partial<Omit<Client, keyof Standard | "sortName">> & { name: string };

export type ClientPatch = Partial<Omit<Client, keyof Standard | "sortName">>;

/**
 * A client can carry several of each of these. `label` is free text rather
 * than a fixed list ("Facturatie", "Kantoor Leuven", "Magazijn"), because the
 * set of labels a business actually needs is not one Juno can predict. The
 * first one added for a client becomes primary automatically; after that,
 * `isPrimary` is only ever set explicitly.
 */
export interface ClientEmail extends Standard {
	clientId: string;
	email: string;
	label: string | null;
	isPrimary: boolean;
}

export type ClientEmailInput = Partial<Omit<ClientEmail, keyof Standard>> & {
	clientId: string;
	email: string;
};

export type ClientEmailPatch = Partial<Omit<ClientEmail, keyof Standard | "clientId">>;

export interface ClientPhone extends Standard {
	clientId: string;
	phone: string;
	label: string | null;
	isPrimary: boolean;
}

export type ClientPhoneInput = Partial<Omit<ClientPhone, keyof Standard>> & {
	clientId: string;
	phone: string;
};

export type ClientPhonePatch = Partial<Omit<ClientPhone, keyof Standard | "clientId">>;

export interface ClientAddress extends Standard {
	clientId: string;
	/** "Kantoor Leuven", "Magazijn". Most clients only need one, so this is optional. */
	label: string | null;
	addressLine1: string;
	addressLine2: string | null;
	postalCode: string | null;
	city: string | null;
	country: string | null;
	isPrimary: boolean;
}

export type ClientAddressInput = Partial<Omit<ClientAddress, keyof Standard>> & {
	clientId: string;
	addressLine1: string;
};

export type ClientAddressPatch = Partial<Omit<ClientAddress, keyof Standard | "clientId">>;

/* ----------------------------------------------------------------- contacts */

export interface Contact extends Standard {
	clientId: string;
	name: string;
	role: string | null;
	email: string | null;
	phone: string | null;
	isPrimary: boolean;
	notes: string | null;
}

export type ContactInput = Partial<Omit<Contact, keyof Standard>> & {
	clientId: string;
	name: string;
};

export type ContactPatch = Partial<Omit<Contact, keyof Standard | "clientId">>;

/* ----------------------------------------------------------------- projects */

/** app keeps the files under userData, custom keeps them in `storagePath`. */
export type ProjectStorageMode = "app" | "custom";

export interface Project extends Standard {
	/** Null for work that is not for anyone: Juno's own repository, a side project. */
	clientId: string | null;
	name: string;
	statusId: string | null;
	description: string | null;
	startsOn: IsoDate | null;
	dueOn: IsoDate | null;
	agreedValueCents: Cents | null;
	notes: string | null;
	/** The checkout on this machine. Juno reads it and never writes to it. */
	localPath: string | null;
	storageMode: ProjectStorageMode;
	/** The folder chosen when `storageMode` is custom, absolute. */
	storagePath: string | null;
	coverAssetId: string | null;
}

export interface ProjectSummary {
	id: string;
	clientId: string | null;
	clientName: string | null;
	name: string;
	status: ReferenceItem | null;
	dueOn: IsoDate | null;
	agreedValueCents: Cents | null;
	description: string | null;
	localPath: string | null;
	/** So the screen can offer "what did I touch last" without reading each row. */
	updatedAt: string;
	/** The asset the card shows, already resolved to something that exists. */
	coverAssetId: string | null;
	/** The kinds of link this project has, so a card can show them without a second call. */
	linkKinds: ProjectLinkKind[];
	assetCount: number;
	commandCount: number;
}

/**
 * Storage and the cover are left out of both of these on purpose. Moving a
 * project's files copies them and then deletes the originals, and setting a
 * cover has to check the asset is still there, so neither is a field you set in
 * passing on a form that was really about a due date. They have their own
 * functions: projects.setStorage and projects.setCover.
 */
type ProjectWritable = Omit<Project, keyof Standard | "storageMode" | "storagePath" | "coverAssetId">;

export type ProjectInput = Partial<ProjectWritable> & { name: string };

export type ProjectPatch = Partial<ProjectWritable>;

export interface ProjectStorageChoice {
	mode: ProjectStorageMode;
	/** Required when the mode is custom, ignored otherwise. */
	path?: string | null;
	/** Carry the files that are already there across to the new folder. */
	move?: boolean;
}

/* ----------------------------------------------------------- project links */

/**
 * What a link points at. The kind picks the icon and nothing else: opening one
 * is decided by whether the target parses as an https URL or a local path.
 */
export type ProjectLinkKind = "github" | "figma" | "website" | "design" | "docs" | "folder" | "other";

export interface ProjectLink extends Standard {
	projectId: string;
	kind: ProjectLinkKind;
	label: string;
	/** An https URL, or an absolute path to a folder or file on this machine. */
	target: string;
	notes: string | null;
	sortOrder: number;
}

export type ProjectLinkInput = Partial<Omit<ProjectLink, keyof Standard>> & {
	projectId: string;
	label: string;
	target: string;
};

export type ProjectLinkPatch = Partial<Omit<ProjectLink, keyof Standard | "projectId">>;

/* ---------------------------------------------------------- project assets */

/**
 * managed: Juno copied the file into the project's folder and owns it, so
 * deleting the asset deletes the file. linked: the file stayed where it was,
 * which is what a ten-gigabyte export wants, and deleting the asset leaves it
 * alone.
 */
export type ProjectAssetStorage = "managed" | "linked";

/** Decides whether the file previews, and which placeholder it gets if not. */
export type ProjectAssetKind = "image" | "pdf" | "video" | "audio" | "archive" | "file";

export interface ProjectAsset extends Standard {
	projectId: string;
	fileName: string;
	storage: ProjectAssetStorage;
	/** Relative to the project folder when managed, absolute when linked. */
	path: string;
	byteSize: number | null;
	mimeType: string | null;
	kind: ProjectAssetKind;
	caption: string | null;
	sortOrder: number;
	/** Resolved absolute path, for showing where a file actually is. */
	absolutePath: string;
	/** False when the file behind the row is gone, which a linked file can be. */
	exists: boolean;
}

export type ProjectAssetPatch = {
	fileName?: string;
	caption?: string | null;
	sortOrder?: number;
};

/* -------------------------------------------------------- project commands */

/** An icon, not a mechanism. Both kinds run the same way. */
export type ProjectCommandKind = "shell" | "docker";

export interface ProjectCommand extends Standard {
	projectId: string;
	label: string;
	command: string;
	/** Null falls back to the project's local folder. */
	workingDir: string | null;
	kind: ProjectCommandKind;
	sortOrder: number;
}

export type ProjectCommandInput = Partial<Omit<ProjectCommand, keyof Standard>> & {
	projectId: string;
	label: string;
	command: string;
};

export type ProjectCommandPatch = Partial<Omit<ProjectCommand, keyof Standard | "projectId">>;

/**
 * A running command, held in memory rather than in the database. A process is
 * not a record: it does not survive a restart, and writing every line it prints
 * to SQLite would be a log file with extra steps.
 */
export interface ProjectRun {
	commandId: string;
	projectId: string;
	label: string;
	command: string;
	workingDir: string;
	state: "running" | "exited" | "failed";
	pid: number | null;
	startedAt: string;
	endedAt: string | null;
	exitCode: number | null;
	/** Why it could not start, or why it stopped badly. */
	error: string | null;
	/** The tail of what it printed. Bounded, oldest lines dropped first. */
	output: string[];
}

/** Where a project's own files are kept, and whether that folder is reachable. */
export interface ProjectStorageInfo {
	projectId: string;
	mode: ProjectStorageMode;
	/** The folder in use, absolute, whichever mode it is in. */
	path: string;
	/** Where the app would keep it, so the settings can offer a way back. */
	defaultPath: string;
	exists: boolean;
	/** Managed files only. A linked file is not Juno's to count. */
	fileCount: number;
	byteSize: number;
}

/** How the projects screen is drawn. Kept in settings.json, not the database. */
export interface ProjectsView {
	layout: "grid" | "list" | "rows";
	/** Grid tile size. Ignored by the other two layouts. */
	size: "small" | "medium" | "large";
	/** Covers and thumbnails. Off gives a dense screen with no images at all. */
	previews: boolean;
	sort: "recent" | "name" | "due" | "client";
}

/* ------------------------------------------------------- reference data (16) */

/** The sets that ship. A set key is stable; its items are editable. */
export type ReferenceSetKey = "client_status" | "project_status" | "document_status" | "label";

export interface ReferenceSet extends Standard {
	key: ReferenceSetKey;
	label: string;
	description: string | null;
	allowsCustomItems: boolean;
}

export interface ReferenceItem extends Standard {
	setId: string;
	key: string;
	label: string;
	/** A token name from brand/tokens.css: ok, warn, risk, seal, accent. Never a hex. */
	tone: string | null;
	seedKey: string | null;
	isSystem: boolean;
	hiddenAt: Iso | null;
	customisedAt: Iso | null;
	sortOrder: number;
}

export interface ReferenceSetWithItems {
	set: ReferenceSet;
	items: ReferenceItem[];
}

export type ReferenceItemInput = {
	setId: string;
	label: string;
	key?: string;
	tone?: string | null;
	sortOrder?: number;
};

export type ReferenceItemPatch = Partial<Pick<ReferenceItem, "label" | "tone" | "sortOrder">>;

/** What a reset does with rows the user created themselves. */
export type ResetUserItems = "keep" | "remove";

export interface ResetResult {
	restored: number;
	unhidden: number;
	userItemsKept: number;
	userItemsRemoved: number;
}

/** Why an item cannot be removed outright. Hiding is always allowed. */
export interface ReferenceUsage {
	itemId: string;
	inUseBy: number;
}

/* ----------------------------------------------------------------- settings */

export type ThemeSetting = "system" | "light" | "dark";

/**
 * The tabs of the settings window, and what a deep link into it may name. The
 * main window uses this to send someone straight to mail accounts from the
 * screen that needs one.
 */
export type SettingsSection = "general" | "business" | "mail" | "documents" | "security" | "mcp";

/**
 * One of the owner's email addresses. Several are normal, at most one is
 * primary, and an address nobody reads is still worth recording: the one on an
 * old domain, the one a client insists on using, the one that only forwards.
 * The primary is what a generated document prints.
 */
export interface OwnerEmail {
	id: string;
	email: string;
	/** What it is for, in the owner's own words. "Invoices", "old domain". */
	label: string | null;
	isPrimary: boolean;
}

/** One of the owner's phone numbers. Same rules as OwnerEmail. */
export interface OwnerPhone {
	id: string;
	phone: string;
	label: string | null;
	isPrimary: boolean;
}

export interface OwnerProfile {
	businessName: string;
	firstName: string;
	lastName: string;
	vatNumber: string;
	/**
	 * The establishment unit number of the registered office, the Belgian
	 * vestigingsnummer that starts with a 2. Not the enterprise number, which is
	 * the VAT number without its country prefix.
	 */
	establishmentNumber: string;
	addressLine1: string;
	addressLine2: string;
	postalCode: string;
	city: string;
	country: string;
	iban: string;
	emails: OwnerEmail[];
	phones: OwnerPhone[];
}

/**
 * The scalar half of the profile. The two lists are edited one entry at a time,
 * so a patch that carried them would let a stale form wipe an address added
 * somewhere else.
 */
export type OwnerProfilePatch = Partial<Omit<OwnerProfile, "emails" | "phones">>;

export type OwnerEmailInput = {
	email: string;
	label?: string | null;
	isPrimary?: boolean;
};

export type OwnerEmailPatch = Partial<OwnerEmailInput>;

export type OwnerPhoneInput = {
	phone: string;
	label?: string | null;
	isPrimary?: boolean;
};

export type OwnerPhonePatch = Partial<OwnerPhoneInput>;

export interface AppSettings {
	theme: ThemeSetting;
	/**
	 * Whether the main sidebar, opened fully, goes back to the rail on its own
	 * when an entry is chosen or something beside it is clicked.
	 */
	sidebarAutoCollapse: boolean;
	lock: LockSettings;
	owner: OwnerProfile;
	seedVersion: number;
	/**
	 * The version of the mail templates set this install has been through, 0 for
	 * never. It sits beside the reference data's version because it describes
	 * the installation, and it is what tells a first install from an upgrade.
	 */
	mailTemplateSeedVersion: number;
	/** The same for document templates: 0 is never, and it tells a first install from an upgrade. */
	documentTemplateSeedVersion: number;
	/** The signature image stamped onto signed PDFs, or null when none is set. */
	signaturePath: string | null;
	/**
	 * Where invoicing actually happens. Juno never raises an invoice; an invoice
	 * reminder links here instead. See decision 9.
	 */
	accountingTool: AccountingTool;
	/** The last day the daily summary was sent, so a restart does not repeat it. */
	lastNotifiedOn: IsoDate | null;
	/** What the person has been through once, so it is never shown twice. */
	onboarding: OnboardingState;
	/** How the projects screen is drawn. A preference, not a record. */
	projectsView: ProjectsView;
	/** Whether updates install themselves, and when the last check ran. */
	updates: UpdateSettings;
}

export interface OnboardingState {
	/**
	 * Null means setup has not been finished, and a launch shows it. It is set
	 * when the last step is passed, including when the person skips the optional
	 * ones, because "I do not want to answer that" is still an answer.
	 */
	completedAt: Iso | null;
	/** Null means the walkthrough has not been seen. It can be replayed. */
	walkthroughSeenAt: Iso | null;
	/**
	 * The setup this person went through. Bumped when a step is added that an
	 * existing install has never been asked, so it can be asked once.
	 */
	version: number;
}

/** What the setup window writes back as it is filled in. */
export type OnboardingPatch = Partial<OnboardingState>;

export interface AccountingTool {
	name: string;
	url: string;
}

/* ------------------------------------------------------------------ updates */

/**
 * What a settings screen has to draw, and the only thing that decides which
 * button it offers. One field rather than a set of booleans, because
 * "downloading" and "ready" are not two independent facts.
 */
export type UpdateStage =
	/** Not a packaged build, so there is no version to compare and nothing to install. */
	| "unsupported"
	/** Nothing has been checked yet this launch. */
	| "idle"
	| "checking"
	/** Checked, and this is the newest release there is. */
	| "current"
	/** A newer release exists and has not been downloaded. */
	| "available"
	| "downloading"
	/** Downloaded and waiting. Installing is a restart away. */
	| "ready"
	| "error";

export interface UpdateStatus {
	stage: UpdateStage;
	/** The version running right now. */
	currentVersion: string;
	/** The newer version, once a check has found one. */
	newVersion: string | null;
	/** When that release was published, so the screen can say how old it is. */
	releasedAt: Iso | null;
	/** 0 to 100 while downloading, 0 otherwise. */
	percent: number;
	lastCheckedAt: Iso | null;
	/** When the next automatic check is due. Null when none is scheduled. */
	nextCheckAt: Iso | null;
	autoInstall: boolean;
	/** One sentence, set only while the stage is error. */
	error: string | null;
}

export interface UpdateSettings {
	/**
	 * On: a found update downloads in the background and installs when Juno
	 * next closes, so the following launch is the new version. Off: nothing is
	 * downloaded until someone presses Install here.
	 */
	autoInstall: boolean;
	/** Persisted so a restart does not start the interval over. */
	lastCheckedAt: Iso | null;
}

/* --------------------------------------------------------------------- lock */

export type LockMethod = "none" | "passphrase" | "pin";

export interface LockSettings {
	method: LockMethod;
	/** Minutes of inactivity before locking. 0 disables the idle timer. */
	idleMinutes: number;
	lockOnSleep: boolean;
	lockOnMinimise: boolean;
}

export interface LockState {
	/** Whether a secret is configured at all. */
	configured: boolean;
	locked: boolean;
	method: LockMethod;
	/** Set while rate-limited after failed attempts. */
	lockedOutUntil: Iso | null;
	failedAttempts: number;
}

export interface UnlockResult {
	ok: boolean;
	/** Present when the attempt failed. */
	reason?: "wrong-secret" | "rate-limited" | "not-configured";
	lockedOutUntil?: Iso | null;
	remainingAttempts?: number;
}

/* ------------------------------------------------------------------- backup */

export interface BackupInfo {
	path: string;
	createdAt: Iso;
	sizeBytes: number;
}

/* -------------------------------------------------------------------- misc */

export type SearchKind = "client" | "project" | "contact" | "document" | "event" | "mail";

export interface SearchHit {
	kind: SearchKind;
	id: string;
	title: string;
	subtitle: string | null;
	/** `YYYY-MM-DD` for a hit that has a date, so a list can be read in order. */
	on?: IsoDate | null;
}

export interface SearchQuery {
	term: string;
	/** Which kinds to look in. Left out means all of them. */
	kinds?: SearchKind[];
	limit?: number;
}

export interface AppInfo {
	version: string;
	databasePath: string;
	isDev: boolean;
	platform: NodeJS.Platform;
}

/* ------------------------------------------------- templates: declared inputs */

/**
 * What kind of answer an input wants. This decides the control shown when a
 * template is used, and how the value is formatted before it reaches the body.
 */
export type TemplateInputKind =
	| "text"
	| "textarea"
	| "number"
	| "money"
	| "date"
	| "choice"
	/** An https URL to a picture. Rendered as an image, not as its address. */
	| "image"
	/** An https URL, rendered as a link. */
	| "url";

/**
 * A value a template asks for when it is used, because nothing in the records
 * can answer it: the scope of the work, an amount agreed on the phone, a
 * deadline. The key is the extras key, so an input keyed `scope` is written
 * `{{document.scope}}` in the body.
 */
export interface TemplateInput {
	key: string;
	label: string;
	kind: TemplateInputKind;
	required: boolean;
	/** One sentence under the field. */
	help?: string | null;
	/** Offered as the starting value. */
	defaultValue?: string | null;
	/** The choices, for `choice`. Ignored for every other kind. */
	options?: string[];
}

/* ----------------------------------------------- mail templates: the canvas */

/**
 * A colour in a mail template is a hex string, not a token.
 *
 * Every other surface in Juno reads `brand/tokens.css`, and this one cannot: a
 * message is read in somebody else's mail client, which has never heard of a
 * CSS variable. The same reason mail-html.ts writes the house palette out as
 * values.
 *
 * `#rgb`, `#rrggbb`, or `#rrggbbaa` for a colour with an opacity of its own,
 * Figma's percentage beside the hex. The compiler writes an opacity as
 * `rgba()` after the flat colour, so a client that cannot read `rgba()`, which
 * is Outlook on Windows, paints the colour solid rather than not at all.
 */
export type MailColor = string;

/** Which sides a stroke is drawn on. All four, or any of them, the way Figma's stroke sides work. */
export interface MailSides {
	top: boolean;
	right: boolean;
	bottom: boolean;
	left: boolean;
}

/** Pixels on each side. Email measures in pixels, not millimetres. */
export interface MailSpacing {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export type MailDirection = "row" | "column";
export type MailJustify = "start" | "center" | "end" | "between" | "around";
export type MailAlign = "start" | "center" | "end" | "stretch";
export type MailTextAlign = "left" | "center" | "right" | "justify";
/** The nine weights a typeface can have, by the names designers use for them. */
export type MailWeight =
	| "thin"
	| "extralight"
	| "light"
	| "normal"
	| "medium"
	| "semibold"
	| "bold"
	| "extrabold"
	| "black";

/** Where a block sits across its section, when that is not what the section says. */
export type MailSelfAlign = "auto" | "start" | "center" | "end" | "stretch";

export type MailVerticalAlign = "top" | "middle" | "bottom";
export type MailTextDecoration = "none" | "underline" | "strike";
export type MailTextCase = "none" | "upper" | "lower" | "title";

/**
 * Every element the Containers group in the toolbar can add. Each lays out
 * what is in it the way a section always has: flow, gap, padding, alignment,
 * breakpoints. A version 1 section becomes a `section` container; a `div`
 * added from the toolbar stays a `div`. Every other tag is written as itself.
 */
export type MailContainerTag = "section" | "div" | "header" | "footer" | "main" | "article" | "aside" | "nav";

/** Every level a heading's own tag can be. */
export type MailHeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/**
 * Every tag the Text group can add, bar heading, which has its own list. `ul`
 * and `ol` are a list: `html` holds its `<li>` items, sanitised for those tags
 * and nothing else.
 */
export type MailTextTag = "p" | "blockquote" | "pre" | "address" | "span" | "ul" | "ol";

/**
 * How a section arranges what is in it. Two choices, and there is deliberately
 * no third: nothing in a mail template is positioned absolutely, so a block is
 * placed by the rules of the section holding it or it is not placed at all.
 *
 * This is flexbox and grid as the author means them, and it is compiled to
 * literal `display:flex` and `display:grid`. Outlook on Windows renders with
 * Word's engine, which supports neither, and stacks every section into one
 * column with the gaps and the alignment dropped. The editor says so on the
 * section inspector rather than leaving it to be discovered by a client.
 */
export type MailSectionLayout =
	| {
			kind: "flex";
			direction: MailDirection;
			justify: MailJustify;
			align: MailAlign;
			/** Pixels between children. */
			gap: number;
			wrap: boolean;
	  }
	| {
			kind: "grid";
			columns: number;
			gap: number;
			/** Down the cell: `align-items`. */
			align: MailAlign;
			/**
			 * Across the cell: `justify-items`. Stretch is the grid's own default and
			 * writes nothing, which is what a grid saved before this field had.
			 */
			justify: MailAlign;
	  };

/**
 * A fill: one flat colour, or a two-stop linear gradient.
 *
 * A gradient is compiled as `background-image:linear-gradient(...)` with its
 * first stop written out as a plain `background-color` underneath, because
 * Outlook on Windows drops the image and would otherwise paint nothing at
 * all. Every fill therefore has a flat colour a client can fall back to.
 */
export type MailFill = (
	| { kind: "solid"; color: MailColor }
	| { kind: "gradient"; angle: number; from: MailColor; to: MailColor }
) & {
	/** Figma's eye on a fill: kept in the panel, left out of the message. */
	hidden: boolean;
};

/** How a border is drawn. Three values, because those are the three every mail
 * client draws the same way. */
export type MailStrokeStyle = "solid" | "dashed" | "dotted";

/** The four corners, for when they are not all the same. */
export interface MailCorners {
	topLeft: number;
	topRight: number;
	bottomRight: number;
	bottomLeft: number;
}

/**
 * A drop shadow, an inner shadow, or a blur.
 *
 * The same three effects Figma calls them, minus a background blur: that is
 * `backdrop-filter`, which no mail client on the list renders, and an effect
 * nothing applies is an effect that lies about what the message will look
 * like. A shadow compiles to `box-shadow` and a blur to `filter`, both of
 * which a client that does not know them ignores without breaking the layout.
 */
export type MailEffect = (
	| {
			kind: "shadow";
			/** Inside the box rather than under it. Figma's inner shadow. */
			inset: boolean;
			x: number;
			y: number;
			blur: number;
			spread: number;
			color: MailColor;
			/** 0 to 1. A shadow is almost never opaque. */
			opacity: number;
	  }
	| { kind: "blur"; radius: number }
) & {
	/** Figma's eye on an effect. */
	hidden: boolean;
};

/**
 * What a click on an element does. One target, one of three shapes: `link`
 * opens an https address, `mail` starts a message to an address and `call`
 * dials a number. The compiler builds `https://...`, `mailto:...` or `tel:...`
 * from `target` and runs the result through `safeHref`, so nothing else can be
 * written, and an element with no usable target is sent without a link.
 */
export interface MailClickAction {
	id: string;
	trigger: "click";
	kind: "link" | "mail" | "call";
	/** The address after `https://`, the email address, or the phone number. */
	target: string;
	/** Figma's eye: kept in the panel, left out of the message. */
	hidden: boolean;
}

/**
 * What the pointer resting on an element changes, one change per row. It is
 * written as a `:hover` rule in the head of the message, which Apple Mail, iOS
 * and Outlook on the web apply and Gmail and Outlook on Windows do not, so it
 * is only ever a nicety on top of a design that already works without it.
 */
export interface MailHoverAction {
	id: string;
	trigger: "hover";
	change: "fill" | "color" | "underline" | "opacity";
	/** For `fill`. */
	fill?: MailFill;
	/** For `color`: the text colour. */
	color?: MailColor;
	/** For `underline`: whether the text is underlined while the pointer is over it. */
	underline?: boolean;
	/** For `opacity`: 0 to 1. */
	opacity?: number;
	hidden: boolean;
}

/**
 * An action on an element: a click that opens something, or a hover that
 * changes how it looks. Nothing else, because focus, scroll and timed triggers
 * need a script, and every mail client removes scripts (docs/editors.md).
 */
export type MailAction = MailClickAction | MailHoverAction;

/**
 * The box around anything: a section or a single block.
 *
 * This is the appearance panel, and it is deliberately the set of Figma
 * controls that survives being read in somebody else's mail client: a fill, a
 * stroke, corner radii, opacity and effects. There is nothing here that
 * places the box, because nothing in this model is placed.
 *
 * `customCss` is declarations only (`text-transform:uppercase`), applied after
 * everything above it so a hand-written value wins. Anything that positions is
 * stripped on the way in by `sanitiseDeclarations` in
 * services/mail-layout.ts, because a template whose author can write
 * `position:absolute` is a template that has the thing this model exists to
 * prevent.
 */
export interface MailBoxStyle {
	fill: MailFill | null;
	padding: MailSpacing;
	/**
	 * Room outside the box, in pixels, zero on every side. A side the element's
	 * own alignment already sets to `auto` (centring, or pushing to an end) keeps
	 * that and takes no number; a table cell takes none at all, since a `td`
	 * ignores one.
	 */
	margin: MailSpacing;
	borderWidth: number;
	borderColor: MailColor | null;
	borderStyle: MailStrokeStyle;
	/** The sides the stroke is drawn on. A section with only a bottom stroke is a divider. */
	borderSides: MailSides;
	/** Figma's eye on the stroke: kept in the panel, left out of the message. */
	strokeHidden: boolean;
	/** Used for all four corners unless `corners` says otherwise. */
	borderRadius: number;
	corners: MailCorners | null;
	/** 0 to 1. 1 is opaque, and is what everything starts at. */
	opacity: number;
	effects: MailEffect[];
	/**
	 * A fixed width in pixels, or null to hug the content or fill the room.
	 * Compiled with `max-width:100%`, so a fixed box still gives way on a phone
	 * rather than pushing the message sideways.
	 */
	width: number | null;
	/**
	 * The least height, in pixels, measured the way Figma measures a height,
	 * padding and stroke included. Content taller than it still makes it
	 * taller. An empty section with one is how a divider or a gap is drawn.
	 */
	minHeight: number | null;
	/** Figma's clip content: whatever reaches past the box is cut off at its edge. */
	clip: boolean;
	customCss: string | null;
}

export interface MailTextStyle {
	color: MailColor | null;
	/**
	 * A family name: one of the system families every mail client has, or the
	 * family of a font the canvas links (`MailLayout.fonts`). Null is the
	 * message's own typeface.
	 */
	fontFamily: string | null;
	/** Pixels. Null leaves the shell's own size alone. */
	fontSize: number | null;
	/** A multiplier, so 1.5 is 150%. */
	lineHeight: number | null;
	/** Pixels between letters. Negative tightens. Null leaves it alone. */
	letterSpacing: number | null;
	weight: MailWeight;
	italic: boolean;
	decoration: MailTextDecoration;
	transform: MailTextCase;
	align: MailTextAlign;
	/** Where the text sits inside a block that is taller than it. */
	verticalAlign: MailVerticalAlign;
}

/**
 * One thing in a section.
 *
 * `grow` is the flex grow factor, and it is the only sizing control there is:
 * a block takes its content's width, or a share of what is left. No width in
 * pixels, because a mail body is read at widths this editor cannot know.
 *
 * `field` is a declared input placed as a block rather than typed as a
 * placeholder. It compiles to `{{document.<inputKey>}}`, or to an `<img>`
 * around it when the input it names is an image, which is what makes a picture
 * something a template can ask for.
 *
 * `html` is the escape hatch, and it is where anything the code view could not
 * place ends up. It is sanitised, never evaluated.
 */
/** What every block has, whatever kind it is. */
export interface MailBlockCommon {
	id: string;
	/** The flex grow factor. 0 hugs the content, 1 or more takes a share of what is left. */
	grow: number;
	/** Where it sits across its section, overriding the section's own alignment. */
	alignSelf: MailSelfAlign;
	/** Figma's eye. A hidden block stays on the canvas and is left out of the message. */
	hidden: boolean;
	/** At most one on-click action and one hover action per kind of change. Empty by default. */
	actions: MailAction[];
}

export type MailBlock = MailBlockCommon &
	(
		| { kind: "text"; tag: MailTextTag; html: string; text: MailTextStyle; box: MailBoxStyle }
		| { kind: "heading"; tag: MailHeadingTag; content: string; text: MailTextStyle; box: MailBoxStyle }
		| {
				kind: "button";
				label: string;
				/** A button block is its own link. Every other element links through an on-click action. */
				href: string;
				background: MailColor;
				/** The label's colour. The rest of its type is `text`, whose own colour is not used. */
				color: MailColor;
				radius: number;
				text: MailTextStyle;
				box: MailBoxStyle;
		  }
		| {
				kind: "image";
				src: string;
				alt: string;
				/** Pixels, or null for the picture's own width. */
				width: number | null;
				align: MailTextAlign;
				box: MailBoxStyle;
		  }
		| { kind: "divider"; color: MailColor; thickness: number; box: MailBoxStyle }
		| { kind: "spacer"; height: number }
		| { kind: "field"; inputKey: string; text: MailTextStyle; box: MailBoxStyle }
		/**
		 * A block that is its own HTML and CSS, edited as code. What any block
		 * becomes with "Convert to HTML", and what the code view puts anything
		 * it could not place into. The CSS is declarations for the element
		 * itself, or for a div around the markup when it is more than one
		 * element.
		 */
		| { kind: "html"; html: string; css: string }
	);

/**
 * A container: what a section always was, generalised to every tag the
 * Containers group offers and to holding other containers and columns as well
 * as blocks. A version 1 section is a container with `tag: "section"`,
 * `grow: 0`, and its blocks as `children`.
 */
export interface MailContainer {
	id: string;
	kind: "container";
	tag: MailContainerTag;
	/** Left out of the message and kept on the canvas, like a hidden layer. */
	hidden: boolean;
	/** Shown in the layers. Never rendered into the message. */
	name: string;
	/**
	 * Where a container narrower than its parent sits across it: at the start,
	 * in the middle or at the end, written as auto margins. "auto" and
	 * "stretch" are the start. One that fills its parent has nowhere to go.
	 */
	alignSelf: MailSelfAlign;
	/** Flex grow inside its parent, like a block's. 0 at the top level. */
	grow: number;
	layout: MailSectionLayout;
	box: MailBoxStyle;
	actions: MailAction[];
	children: MailNode[];
}

/**
 * One cell of a columns table. Widths are a percentage of the table, or null
 * to share what none of the others claimed.
 */
export interface MailColumnsCell {
	id: string;
	/** Percent of the table's width, 1 to 100, or null to share what is left. */
	width: number | null;
	verticalAlign: MailVerticalAlign;
	box: MailBoxStyle;
	actions: MailAction[];
	children: MailNode[];
}

export interface MailColumnsRow {
	id: string;
	cells: MailColumnsCell[];
}

/**
 * Columns: a table laid out for mail, the one layout that stays side by side
 * in Outlook on Windows ("the Outlook problem", docs/editors.md).
 */
export interface MailColumns {
	id: string;
	kind: "columns";
	hidden: boolean;
	name: string;
	alignSelf: MailSelfAlign;
	grow: number;
	/** Pixels between cells, compiled as cell padding: `border-spacing` is unreliable in mail. */
	gap: number;
	box: MailBoxStyle;
	actions: MailAction[];
	rows: MailColumnsRow[];
}

/** Anything that can sit in the tree: a container, a columns table, or a leaf block. */
export type MailNode = MailContainer | MailColumns | MailBlock;

/**
 * What a breakpoint changes about one block. Only how it looks and where it
 * sits: what it says, where it links and what it shows are the same at every
 * width, so they are not here. A field left out is whatever the wider
 * breakpoints, and in the end the default, say.
 */
export interface MailBlockOverride {
	hidden?: boolean;
	grow?: number;
	alignSelf?: MailSelfAlign;
	box?: Partial<MailBoxStyle>;
	text?: Partial<MailTextStyle>;
	/** A button's fill and label colour, a divider's colour. */
	background?: MailColor;
	color?: MailColor;
	radius?: number;
	/** A picture's width and alignment. */
	width?: number | null;
	align?: MailTextAlign;
	thickness?: number;
	/** A spacer's height. */
	height?: number;
}

/** What a breakpoint changes about one container, columns table or cell. */
export interface MailSectionOverride {
	hidden?: boolean;
	alignSelf?: MailSelfAlign;
	/** A container's or a columns table's share of the room in its own parent. */
	grow?: number;
	layout?: MailSectionLayout;
	box?: Partial<MailBoxStyle>;
}

/**
 * A width at and below which the message looks different: Figma's
 * breakpoints, written as a media query.
 *
 * A breakpoint starts as a copy of the default and holds only what is changed
 * at it, keyed by the id of the section or block, so a change to the default
 * reaches every breakpoint that did not change the same thing. A narrower
 * breakpoint starts from the wider ones, because that is how the media
 * queries stack in a client.
 */
export interface MailBreakpoint {
	id: string;
	name: string;
	/** The widest screen, in pixels, this applies to. */
	maxWidth: number;
	/**
	 * Keyed by id, and the name stayed even though it now covers every
	 * container, columns table and cell, not only a top-level section: the
	 * stored shape a breakpoint already has, and every template that has one
	 * keeps working with no data move.
	 */
	sections: Record<string, MailSectionOverride>;
	blocks: Record<string, MailBlockOverride>;
}

/**
 * One node of a canvas in hand, to be turned into the HTML and CSS it compiles
 * to: a block, or a container or columns table with everything under it as one
 * code block.
 */
export interface MailBlockConversion {
	layout: MailLayout;
	/** The container or cell holding the node directly, or null for the frame's own top level. */
	parentId: string | null;
	nodeId: string;
	/** What the template asks for, which decides how an input block compiles. */
	inputs?: TemplateInput[];
}

/** A Google font asked for by name, for the editor's canvas to paint with. */
export interface GoogleFontRequest {
	family: string;
	weights: number[];
	italic: boolean;
}

/**
 * A Google font the canvas can use: the stylesheet the message links, and
 * the same faces with their files written inline. The inline copy is for the
 * editor only and is never sent.
 */
export interface GoogleFontLoad {
	family: string;
	href: string;
	css: string;
}

/** What a client that will not load a linked font shows in its place. */
export type MailFontFallback = "sans" | "serif" | "mono";

/**
 * A typeface the message links rather than one every client already has.
 *
 * Linked in the head of the message as a stylesheet, which Apple Mail, iOS,
 * Outlook for Mac and most Android clients load and Gmail and Outlook on
 * Windows do not. So every font carries a fallback, and the text is written in
 * `'Family', <fallback stack>` everywhere it is used: the message still reads
 * as intended in a client that ignores the link.
 *
 * A Google font is named rather than linked, and the stylesheet address is
 * built from the name. That is also what lets the editor show it: Juno asks
 * Google for it once by name, and never fetches an address a person or an
 * agent typed (security.md section 2). A font from anywhere else is a link the
 * recipient's client loads and Juno does not, so the canvas shows the
 * fallback for it and says so.
 */
export interface MailFont {
	/** The family name, exactly as the stylesheet declares it. What a text block names. */
	family: string;
	source: "google" | "link";
	/** An https stylesheet, for a linked font. Null for Google, where it is built from the name. */
	href: string | null;
	/** The weights to ask Google for, 100 to 900. */
	weights: number[];
	/** Whether to ask Google for the italics too. */
	italic: boolean;
	fallback: MailFontFallback;
}

/**
 * The editable shape of a mail template. `bodyHtml` is compiled from this on
 * every save, so the renderer, the placeholder substitution and the outbox
 * below them never learn that a canvas exists.
 *
 * `width` is the width the message is designed at, the default breakpoint.
 * With `widthMode` "fill" the message takes the whole width of the mail
 * client, and `width` is only the size it is drawn at on the canvas; with
 * "fixed" it is also the widest the message gets, centred in the client.
 * `minHeight` is the canvas the author draws on, not a limit on the message.
 *
 * `version` is the shape of this object, not the template's version number.
 * Version 1 was one level, sections holding blocks; version 2 is a tree, and
 * `normaliseLayout` in services/mail-layout.ts reads a version 1 layout into
 * one, each section becoming a `section` container holding its blocks.
 */
export interface MailLayout {
	version: 2;
	width: number;
	widthMode: "fill" | "fixed";
	minHeight: number;
	fill: MailFill | null;
	/** The typefaces the message links. Every text block can name one of these. */
	fonts: MailFont[];
	customCss: string | null;
	/** The frame's children, top to bottom. Any node may sit at the top level. */
	children: MailNode[];
	/** Narrower widths the message changes at. The default is not in the list. */
	breakpoints: MailBreakpoint[];
}

/* --------------------------------------------- document templates: the page */

/** Millimetres. A page is measured the way a printer measures it. */
export type Mm = number;

export interface PageMargin {
	top: Mm;
	right: Mm;
	bottom: Mm;
	left: Mm;
}

export type LayoutAlign = "left" | "center" | "right" | "justify";

/**
 * One thing on a page. A block either flows in the column inside the margin or
 * sits in a box at a position, which is the same two choices a PDF gives.
 *
 * `html` on a paragraph or a cell is the small allowed set the editor produces:
 * `strong`, `em`, `u`, `s`, `br`, `a`, and `{{ }}` placeholders. It is compiled
 * into the document, so it is sanitised on the way in.
 */
export type LayoutBlock =
	| { id: string; kind: "heading"; level: 1 | 2 | 3; text: string; align: LayoutAlign }
	| { id: string; kind: "paragraph"; html: string; align: LayoutAlign }
	| { id: string; kind: "list"; ordered: boolean; items: string[] }
	| { id: string; kind: "image"; src: string; alt: string; widthMm: Mm; align: LayoutAlign }
	| { id: string; kind: "spacer"; heightMm: Mm }
	| { id: string; kind: "divider" }
	| {
			id: string;
			kind: "table";
			/** Widths are percentages of the column, and should add up to 100. */
			columns: { header: string; widthPct: number }[];
			rows: string[][];
			/** A header row is drawn in bold over a rule. */
			headerRow: boolean;
	  }
	| {
			id: string;
			kind: "signature";
			label: string;
			/** Where the signature image is stamped when the document is signed. */
			widthMm: Mm;
	  };

/**
 * A block pinned to a page. `xMm` and `yMm` are from the top left corner of the
 * paper, not of the text column, because that is what a position on a page
 * means to the person placing it.
 */
export interface LayoutBox {
	id: string;
	xMm: Mm;
	yMm: Mm;
	widthMm: Mm;
	block: LayoutBlock;
}

export interface LayoutPage {
	id: string;
	/** Flows down the column inside the margin, in this order. */
	blocks: LayoutBlock[];
	/** Placed on the paper, over the flow. */
	boxes: LayoutBox[];
}

/**
 * The editable shape of a document template. `bodyHtml` is compiled from this
 * on every save, so the renderer and the PDF pipeline never learn that a page
 * model exists.
 *
 * `version` is the shape of this object, not the template's own version number.
 */
export interface DocumentLayout {
	version: 1;
	pageSize: "A4";
	margin: PageMargin;
	pages: LayoutPage[];
}

/* ---------------------------------------------------------------- documents */

export interface DocumentTemplate extends Standard {
	key: string;
	name: string;
	description: string | null;
	language: string;
	bodyHtml: string;
	/**
	 * Null means nobody has checked the text is sound. Every template starts null,
	 * the example that ships included. See docs/templates.md.
	 */
	reviewedAt: Iso | null;
	version: number;
	isSystem: boolean;
	customisedAt: Iso | null;
	/** Every path the body refers to, for showing what a template needs. */
	placeholders: string[];
	/**
	 * The page model the editor works on. Null means this template is HTML only,
	 * which is true of anything written before the page editor existed, and stays
	 * true for a template somebody prefers to keep as HTML.
	 */
	layout: DocumentLayout | null;
	/** What the template asks for when it is used. Empty when it asks nothing. */
	inputs: TemplateInput[];
}

export type DocumentTemplateInput = {
	name: string;
	/** Left out, a fresh template gets one empty page. */
	bodyHtml?: string;
	key?: string;
	description?: string | null;
	language?: string;
	/** Passing a layout compiles the body from it and ignores `bodyHtml`. */
	layout?: DocumentLayout | null;
	inputs?: TemplateInput[];
};

export type DocumentTemplatePatch = Partial<
	Pick<DocumentTemplateInput, "name" | "description" | "bodyHtml" | "language" | "layout" | "inputs">
>;

export interface DocumentRecord extends Standard {
	clientId: string;
	clientName: string;
	projectId: string | null;
	templateId: string | null;
	templateVersion: number | null;
	title: string;
	statusId: string | null;
	/** The rendered body, frozen at generation. Never re-rendered. */
	bodyHtml: string;
	issuedOn: IsoDate | null;
	pdfPath: string | null;
	/** Generated from a template that had not been reviewed. */
	isSpecimen: boolean;
	/**
	 * `imported` is a PDF that already existed and was brought in. It has no body
	 * to render and no template behind it, so anything that re-renders or
	 * re-generates has to check this before it tries.
	 */
	sourceKind: DocumentSourceKind;
	/** How many files this document has been. Always at least one once it has a PDF. */
	versionCount: number;
	/** The newest version, which is the one `pdfPath` points at. Null before the first PDF. */
	latestVersion: { id: string; kind: DocumentVersionKind; fileDate: Iso } | null;
}

export type DocumentSourceKind = "generated" | "imported";

export interface ImportDocumentInput {
	/** An absolute path to a PDF that exists. Copied in, never referenced. */
	sourcePath: string;
	clientId: string;
	title?: string;
	projectId?: string | null;
	issuedOn?: IsoDate;
}

/** What a version is. Where it came from is `DocumentVersionSource`. */
export type DocumentVersionKind = "generated" | "imported" | "stamped" | "signed";
export type DocumentVersionSource = "generate" | "picker" | "drop" | "mail" | "sign" | "agent";

/** One file a document has been. Newest first wherever a list of them is returned. */
export interface DocumentVersion extends Standard {
	documentId: string;
	kind: DocumentVersionKind;
	source: DocumentVersionSource;
	fileName: string | null;
	/** Orders the versions: the file's own date for an import, the moment it was made otherwise. */
	fileDate: Iso;
	fileHash: string | null;
	signatureId: string | null;
	mailAttachmentId: string | null;
	/** 1 is the oldest. Counted, not stored, so a file slotted in between renumbers the rest. */
	number: number;
	isLatest: boolean;
	/** Filled for a stamped or signed version. */
	signerName: string | null;
	digital: DigitalSignatureInfo | null;
	/** A stamped or signed version has its signing details as a `.cert.pdf` of their own. */
	hasCertificate: boolean;
}

/**
 * A PDF the window hands over: bytes it read from a drop or a picker, or a mail
 * attachment named by id. Never a path. See .claude/rules/security.md section 2.
 */
export type ImportSource =
	| {
			kind: "bytes";
			/** Only ever a title. It never becomes a path. */
			fileName: string;
			data: Uint8Array;
			/** The file's own last-modified time, UTC ISO-8601. Orders the version. */
			fileDate?: Iso;
			/** A drop or a picker. Defaults to a drop. */
			via?: "drop" | "picker";
	  }
	| { kind: "attachment"; attachmentId: string };

/** A file read by the main process's picker, ready to be imported. */
export interface PickedPdf {
	fileName: string;
	data: Uint8Array;
	fileDate: Iso;
}

/** A document the incoming file looks like. */
export interface ImportMatch {
	documentId: string;
	title: string;
	clientId: string;
	clientName: string;
	/** 0 to 1, how much of the text is the same. */
	score: number;
	/** The same bytes are already one of this document's versions. */
	identical: boolean;
	/** Why it is offered: the same text, or only the same name. */
	reason: "text" | "name";
}

export interface ImportAnalysis {
	fileName: string;
	/** What the title would be as a document of its own. */
	defaultTitle: string;
	/** The client the file probably belongs to: the one asked for, the mail's, or the best match's. */
	suggestedClientId: string | null;
	/** Best first. Empty when nothing looks like it. */
	matches: ImportMatch[];
	/** The file's date, which decides where it would sit among the versions. */
	fileDate: Iso;
}

export interface ImportFileInput {
	source: ImportSource;
	clientId: string;
	title?: string;
	projectId?: string | null;
	issuedOn?: IsoDate;
}

export interface AddVersionInput {
	documentId: string;
	source: ImportSource;
}

export interface GenerateDocumentInput {
	clientId: string;
	templateId: string;
	projectId?: string | null;
	title?: string;
	issuedOn?: IsoDate;
	/** Values typed for this document, such as an addendum's change summary. */
	extras?: Record<string, string>;
}

export interface GenerateDocumentResult {
	document: DocumentRecord;
	/** Placeholders the template wanted and the records could not fill. */
	missing: string[];
	/**
	 * Generating writes the PDF, because a document is a PDF. This is the reason
	 * it did not, when it did not. The document itself is still saved, so the
	 * answer is to try the PDF again from the record rather than to fill the
	 * form in a second time.
	 */
	pdfError: string | null;
}

/**
 * Where the stamp goes on the PDF. Fractions of the page, measured from the top
 * left, so the window and the file agree whatever size the page is drawn at.
 * The height is not stored: it follows from the width and the signature image.
 */
export interface StampPlacement {
	/** 1-based. */
	page: number;
	x: number;
	y: number;
	width: number;
}

/** What is known about the certificate, and nothing that could sign with it. */
export interface SigningCertificateInfo {
	subject: string;
	issuer: string;
	serialNumber: string;
	/** SHA-256 of the certificate, hex. */
	fingerprint: string;
	validFrom: Iso;
	validTo: Iso;
	importedAt: Iso;
}

/** The certificate a digital signature was made with, as recorded on the signature. */
export interface DigitalSignatureInfo {
	subject: string;
	issuer: string;
	fingerprint: string;
	validTo: Iso;
}

export interface DocumentSignature extends Standard {
	documentId: string;
	signerName: string;
	signerRole: string | null;
	signedAt: Iso;
	signatureImagePath: string | null;
	/** SHA-256 of the unsigned PDF, so later tampering is detectable. */
	documentHash: string;
	signedPdfPath: string | null;
	/** The signing details as their own PDF. Null for a signature that predates it. */
	certificatePdfPath: string | null;
	/** Null when the document was stamped only. */
	digital: DigitalSignatureInfo | null;
}

export interface SignDocumentInput {
	documentId: string;
	signerName: string;
	signerRole?: string | null;
	/** Leave out to sign without an image, which is still timestamped and hashed. */
	useSignatureImage?: boolean;
	/** False leaves the name and the date off the stamp. Needs the image. Defaults to true. */
	showDetails?: boolean;
	/** Left out, the stamp goes bottom left on the last page. */
	placement?: StampPlacement;
	/**
	 * Adds a cryptographic signature made with the imported certificate. The
	 * passphrase is used once and never stored, so a signature is always an act
	 * by whoever is at the keyboard. Empty for a certificate that has none.
	 */
	digital?: { passphrase: string } | null;
}

/* ---------------------------------------------------------------- reminders */

export type RecurrencePattern = "once" | "days" | "weeks" | "months" | "years" | "quarter_end";

export type ReminderCategory = "paperwork" | "invoice" | "payment" | "renewal" | "other";

/** Which pile a reminder is in today. Computed, never stored. */
export type ReminderBucket = "overdue" | "today" | "soon" | "later" | "snoozed" | "done";

export interface Reminder extends Standard {
	title: string;
	notes: string | null;
	dueOn: IsoDate;
	pattern: RecurrencePattern;
	interval: number;
	anchorDay: number | null;
	/** How many days before the due date it starts asking. */
	leadDays: number;
	category: ReminderCategory;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	documentId: string | null;
	snoozedUntil: IsoDate | null;
	completedAt: Iso | null;
	lastCompletedOn: IsoDate | null;
	/** Where to go to actually do it. Juno never does it. See decision 9. */
	actionUrl: string | null;
	actionLabel: string | null;
	isSystem: boolean;
	bucket: ReminderBucket;
	recurrenceLabel: string;
}

export interface ReminderInput {
	title: string;
	dueOn: IsoDate;
	notes?: string | null;
	pattern?: RecurrencePattern;
	interval?: number;
	anchorDay?: number | null;
	leadDays?: number;
	category?: ReminderCategory;
	clientId?: string | null;
	projectId?: string | null;
	documentId?: string | null;
	actionUrl?: string | null;
	actionLabel?: string | null;
}

export type ReminderPatch = Partial<ReminderInput>;

export interface ReminderListQuery {
	actionableOnly?: boolean;
	includeDone?: boolean;
	clientId?: string;
	category?: ReminderCategory;
}

/**
 * Worked out from the records rather than stored, so it disappears when the
 * situation that produced it changes. Accepting one writes a real reminder.
 */
export interface ReminderSuggestion {
	key: string;
	title: string;
	notes: string;
	category: ReminderCategory;
	dueOn: IsoDate;
	clientId: string | null;
	projectId: string | null;
	actionUrl: string | null;
	actionLabel: string | null;
}

export interface ReminderCompletion {
	id: string;
	reminderId: string;
	/** The date the occurrence was due, not the date it was ticked. */
	dueOn: IsoDate;
	completedAt: Iso;
	note: string | null;
}

/* --------------------------------------------------------------------- mail */

export type MailSecurity = "tls" | "starttls";

/**
 * An account as the renderer sees it. There is no password field, and there
 * never will be: `hasCredential` is the whole of what the interface learns.
 */
export interface MailAccount extends Standard {
	label: string;
	email: string;
	imapHost: string;
	imapPort: number;
	imapSecurity: MailSecurity;
	username: string;
	horizonDays: number;
	syncIntervalMinutes: number;
	syncEnabled: boolean;
	lastSyncAt: Iso | null;
	lastSyncError: string | null;
	hasCredential: boolean;
	/** Null means the account cannot send. */
	smtpHost: string | null;
	smtpPort: number;
	smtpSecurity: MailSecurity;
	/** Overrides the login name for SMTP only. Null means the IMAP username. */
	smtpUsername: string | null;
	/** The display name on outgoing mail. Null means the owner's name. */
	fromName: string | null;
}

/**
 * A removed account that still has mail stored here, and how much. Counts
 * cover every row Juno holds for the account, including messages the server
 * has since deleted, because a purge removes those too.
 */
export interface RemovedMailAccount {
	id: string;
	label: string;
	email: string;
	/** When the account was removed. */
	removedAt: Iso;
	messages: number;
	attachments: number;
	/** Messages composed here for this account: drafts, queued and sent. */
	outboxMessages: number;
	/** The sizes recorded for the attachments. Bodies live in the database, not on disk. */
	attachmentBytes: number;
}

/** What a purge removed. `leftOnDisk` counts files or folders that could not be deleted. */
export interface MailPurgeResult {
	messages: number;
	attachments: number;
	outboxMessages: number;
	leftOnDisk: number;
}

/**
 * Server settings guessed from an address. Filled into the form for a person to
 * look at, never saved on its own: `source` says how much to trust it, and the
 * connection test is what settles it.
 */
export interface MailAutoconfig {
	/**
	 * "known" came from the provider table, "mx" from the domain's mail host,
	 * "convention" is the imap./smtp. fallback and is the one worth checking.
	 */
	source: "known" | "mx" | "convention";
	domain: string;
	imapHost: string;
	imapPort: number;
	imapSecurity: MailSecurity;
	smtpHost: string;
	smtpPort: number;
	smtpSecurity: MailSecurity;
	username: string;
	/** What this provider needs that a password alone does not cover. */
	note: string | null;
}

export interface MailAccountInput {
	label?: string;
	email: string;
	imapHost: string;
	imapPort?: number;
	imapSecurity?: MailSecurity;
	username?: string;
	/** Stored in the credential store on the way in. Never read back. */
	password: string;
	horizonDays?: number;
	syncIntervalMinutes?: number;
	syncEnabled?: boolean;
	smtpHost?: string | null;
	smtpPort?: number;
	smtpSecurity?: MailSecurity;
	smtpUsername?: string | null;
	fromName?: string | null;
}

export type MailAccountPatch = Partial<MailAccountInput>;

export interface MailConnectionTest {
	ok: boolean;
	/** What went wrong, for a person, when ok is false. */
	message: string | null;
	folderCount: number;
}

export type MailSpecialUse = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive";

export interface MailFolder extends Standard {
	accountId: string;
	path: string;
	name: string;
	delimiter: string | null;
	specialUse: MailSpecialUse | null;
	syncEnabled: boolean;
	messageCount: number;
	unreadCount: number;
	lastSyncAt: Iso | null;
}

export interface MailAddress {
	name: string | null;
	address: string;
	clientName?: string;
}

/**
 * A recipient the composer can offer for what has been typed so far.
 *
 * `clients` is every client the address belongs to, not the best one: two
 * clients sharing a bookkeeper both concern a message to that address, and
 * choosing between them here would throw away something nobody can retype.
 */
export interface MailRecipientSuggestion {
	address: string;
	name: string | null;
	clients: { id: string; name: string }[];
	/** A client's own address, a contact's, or one that has written before. */
	source: "client" | "contact" | "message";
}

/** A client an outgoing message concerns, and the address that says so. */
export interface MailMessageClient {
	clientId: string;
	clientName: string;
	matchedAddress: string;
}

export interface MailThreadSummary {
	id: string;
	accountId: string;
	subject: string;
	clientId: string | null;
	clientName: string | null;
	linkSource: "auto" | "manual" | null;
	firstMessageAt: Iso;
	lastMessageAt: Iso;
	messageCount: number;
	unreadCount: number;
	hasAttachments: boolean;
	/** True when any message in the thread is flagged. */
	isFlagged: boolean;
	/** The people on the thread other than the account itself, deduplicated. */
	participants: MailAddress[];
	/** The newest message's first line, or a search snippet when searching. */
	snippet: string;
}

export interface MailAttachment {
	id: string;
	messageId: string;
	filename: string;
	mimeType: string;
	size: number;
	isInline: boolean;
}

/** A message in a thread. Headers always; the body only once fetched. */
export interface MailMessage {
	id: string;
	accountId: string;
	folderId: string;
	threadId: string;
	uid: number;
	messageId: string | null;
	from: MailAddress | null;
	to: MailAddress[];
	cc: MailAddress[];
	replyTo: MailAddress[];
	subject: string;
	snippet: string;
	sentAt: Iso | null;
	internalDate: Iso;
	size: number | null;
	isSeen: boolean;
	isFlagged: boolean;
	isAnswered: boolean;
	hasAttachments: boolean;
	bodyFetched: boolean;
	bodyError: string | null;
	attachments: MailAttachment[];
}

/**
 * Where a message body is served from, as a document of its own with a CSP
 * that allows nothing but inline styles and data: images. The reader points a
 * fully sandboxed frame at `${MAIL_FRAME_ORIGIN}/message/<id>`, and adds
 * `?images=1` only when the person asked for the remote images of that one
 * message.
 */
export const MAIL_FRAME_ORIGIN = "app://mail";

/**
 * Where a project's images are served from, for thumbnails and previews.
 *
 * A third host on the same scheme, and therefore a third origin. The renderer's
 * policy allows it as an image source and as nothing else, so a file that turns
 * out not to be an image is a broken picture rather than a document with a
 * policy of its own. The handler resolves an asset id to a path itself: the
 * renderer never names a file, which is what keeps this from being the
 * arbitrary file reader that .claude/rules/security.md section 2 forbids.
 */
export const ASSET_ORIGIN = "app://asset";

/**
 * What the reader needs beside the frame: the plain text for a message with no
 * HTML, how many remote images were blocked so it can offer to load them, and
 * every link with its real target, since a click inside the frame goes nowhere.
 */
export interface MailMessageBody {
	messageId: string;
	text: string | null;
	hasHtml: boolean;
	remoteImages: number;
	suspicious: boolean;
	links: { href: string; text: string }[];
}

/**
 * A message Juno sent (or is sending) in this thread that has not come back
 * from the server's Sent folder yet. It is read from the outbox, and it drops
 * out of the thread the moment a synced message with the same Message-ID
 * exists, so no message is ever listed twice.
 */
export interface MailThreadOutgoing {
	/** The outbox row's id. Not a mail message id, so nothing else accepts it. */
	id: string;
	accountId: string;
	state: "queued" | "sending" | "sent";
	from: MailAddress;
	to: MailAddress[];
	cc: MailAddress[];
	subject: string;
	bodyText: string;
	bodyHtml: string | null;
	messageId: string;
	/** When it went out, or when it was queued while it has not gone yet. */
	date: Iso;
	attachments: MailOutboxAttachment[];
}

export interface MailThread {
	summary: MailThreadSummary;
	messages: MailMessage[];
	/**
	 * What was sent from Juno into this thread and is not among `messages` yet,
	 * oldest first. Empty once the Sent folder has been synced.
	 */
	outgoing: MailThreadOutgoing[];
}

export interface MailThreadListQuery {
	accountId?: string;
	folderId?: string;
	folderSpecialUse?: MailSpecialUse;
	clientId?: string;
	/** Full-text over subject, body and sender. */
	search?: string;
	unreadOnly?: boolean;
	/** Only threads carrying a flagged message. */
	flaggedOnly?: boolean;
	/** Only threads carrying a real attachment. */
	withAttachments?: boolean;
	/** Only threads a given address took part in. Matched exactly, lowercased. */
	fromAddress?: string;
	/** Only threads whose last message is on or after this date, `YYYY-MM-DD`. */
	since?: string;
	/** Only threads whose last message is on or before this date, `YYYY-MM-DD`. */
	until?: string;
	limit?: number;
	/** The `lastMessageAt` of the last row seen, for the next page. */
	before?: Iso;
}

/**
 * What a move actually did.
 *
 * `remembered` is how many of them Juno can still point at. A server with
 * UIDPLUS says where each message landed, so the row follows it and shows up in
 * the destination immediately. A server without it says nothing, so the row is
 * forgotten and the message reappears when that folder is next synced. The
 * number is in the result rather than hidden, because it is the difference
 * between "it is in Archive" and "it is in Archive and Juno will see it again
 * after a sync", and the interface has to be able to say which happened.
 */
export interface MailFileResult {
	moved: number;
	/** The destination, by the name the folder list shows. */
	folderName: string;
	remembered: number;
}

export type MailSyncPhase = "idle" | "connecting" | "folders" | "headers" | "bodies" | "done" | "failed";

export interface MailSyncStatus {
	accountId: string;
	phase: MailSyncPhase;
	folderPath: string | null;
	/** Progress inside the current phase, when it is known. */
	done: number;
	total: number;
	startedAt: Iso | null;
	finishedAt: Iso | null;
	error: string | null;
	/** What the run produced so far. */
	newMessages: number;
	fetchedBodies: number;
	/**
	 * How much of the mailbox this run knows about and did not reach: headers
	 * inside the horizon it did not list, plus bodies not fetched yet. A run is
	 * bounded on purpose, so this is normal on a large mailbox rather than a
	 * failure, and it is what the next run picks up.
	 */
	pending: number;
}

/* ------------------------------------------------------------- mail: sending */

export type MailRegister = "u" | "je";

export interface MailTemplate extends Standard {
	key: string;
	name: string;
	description: string | null;
	language: string;
	register: MailRegister;
	subject: string;
	bodyHtml: string;
	isSystem: boolean;
	customisedAt: Iso | null;
	/**
	 * Set when a shipped template is removed. Hidden means it is not offered
	 * when composing, and still resolves on every draft that already points at
	 * it (.claude/rules/data.md section 9).
	 */
	hiddenAt: Iso | null;
	placeholders: string[];
	/** What the template asks for when it is used. Empty when it asks nothing. */
	inputs: TemplateInput[];
	/**
	 * The canvas the editor works on. Null means this template is HTML only,
	 * which is true of everything written before the canvas existed and stays
	 * true for a template somebody prefers to keep as HTML.
	 */
	layout: MailLayout | null;
}

export interface MailTemplateInput {
	name: string;
	subject: string;
	bodyHtml: string;
	key?: string;
	description?: string | null;
	register?: MailRegister;
	inputs?: TemplateInput[];
	/** Passing a layout compiles the body from it and ignores `bodyHtml`. */
	layout?: MailLayout | null;
}

export type MailTemplatePatch = Partial<
	Pick<MailTemplateInput, "name" | "subject" | "bodyHtml" | "description" | "register" | "inputs" | "layout">
>;

/**
 * A template rendered from values in hand rather than from the saved row.
 *
 * The editor needs this: a preview that can only read what is saved forces a
 * save on every keystroke, which is how the old editor stamped `customisedAt`
 * on templates nobody had deliberately edited.
 */
export interface MailTemplateDraft {
	subject: string;
	bodyHtml?: string;
	layout?: MailLayout | null;
	inputs?: TemplateInput[];
	clientId?: string | null;
	projectId?: string | null;
	extras?: Record<string, string>;
}

/** A template filled against a client and project, ready to put in a draft. */
export interface MailTemplateRender {
	subject: string;
	bodyHtml: string;
	bodyText: string;
	missing: string[];
}

export type MailOutboxState = "draft" | "pending" | "queued" | "sending" | "sent" | "failed" | "cancelled";

export interface MailOutboxAttachment {
	id: string;
	documentId: string;
	filename: string;
}

export interface MailOutboxMessage extends Standard {
	accountId: string;
	state: MailOutboxState;
	to: MailAddress[];
	cc: MailAddress[];
	bcc: MailAddress[];
	subject: string;
	bodyText: string;
	bodyHtml: string | null;
	messageId: string;
	inReplyTo: string | null;
	replyToMessageId: string | null;
	threadId: string | null;
	clientId: string | null;
	clientName: string | null;
	/**
	 * Every client the recipients belong to, worked out from the addresses. The
	 * message is filed under `clientId`; this is the rest of them, and a message
	 * to two clients carries both rather than silently one.
	 */
	clients: MailMessageClient[];
	projectId: string | null;
	templateId: string | null;
	requestedBy: "user" | "agent";
	approvedAt: Iso | null;
	queuedAt: Iso | null;
	attempts: number;
	lastError: string | null;
	sentAt: Iso | null;
	appendedToSentAt: Iso | null;
	appendError: string | null;
	attachments: MailOutboxAttachment[];
}

export interface MailDraftInput {
	accountId: string;
	to: MailAddress[];
	cc?: MailAddress[];
	bcc?: MailAddress[];
	subject: string;
	/** Plain text. The HTML version is made from it unless bodyHtml is given. */
	bodyText: string;
	/** Already rendered HTML, from a template. Left out for a plain message. */
	bodyHtml?: string | null;
	/** The local message this answers. Sets the threading headers. */
	replyToMessageId?: string | null;
	clientId?: string | null;
	projectId?: string | null;
	templateId?: string | null;
	/** Documents to attach. Their PDF is rendered at send time if needed. */
	documentIds?: string[];
}

export type MailDraftPatch = Partial<Omit<MailDraftInput, "accountId">>;

/** What a reply starts from: the addresses and subject, worked out from the original. */
/** Reply to the sender, reply to everyone, or forward it to somebody new. */
export type MailReplyMode = "reply" | "reply_all" | "forward";

export interface MailReplySeed {
	accountId: string;
	to: MailAddress[];
	cc: MailAddress[];
	subject: string;
	/** The original, quoted, for under the reply. */
	quotedText: string;
	/** Null for a forward: it starts a conversation rather than continuing one. */
	replyToMessageId: string | null;
	clientId: string | null;
}

export interface MailOutboxListQuery {
	accountId?: string;
	states?: MailOutboxState[];
	limit?: number;
}

export interface MailOutboxCounts {
	pending: number;
	queued: number;
	failed: number;
	drafts: number;
}

/* ----------------------------------------------------------------- calendar */

/**
 * A wall-clock reading with no zone: `YYYY-MM-DDTHH:MM:SS` for a timed event,
 * `YYYY-MM-DD` for an all-day one. The zone is carried beside it.
 */
export type LocalDateTime = string;

/** Which occurrences an edit or a removal of a recurring event reaches. */
export type CalendarScope = "this" | "following" | "all";

export interface CalendarException {
	id: string;
	eventId: string;
	/** The start the rule produced, in the master's zone. RECURRENCE-ID in a file. */
	occurrenceStartLocal: LocalDateTime;
	cancelled: boolean;
	title: string | null;
	notes: string | null;
	location: string | null;
	startLocal: LocalDateTime | null;
	endLocal: LocalDateTime | null;
}

/** A single event, or the master of a series, with its exceptions. */
export interface CalendarEvent extends Standard {
	title: string;
	notes: string | null;
	location: string | null;
	allDay: boolean;
	startLocal: LocalDateTime;
	/** Exclusive. A one-day all-day event ends on the next date. */
	endLocal: LocalDateTime;
	/** IANA zone name. */
	timezone: string;
	/** RFC 5545 rule without the RRULE: prefix, null for a single event. */
	rrule: string | null;
	recurrenceLabel: string;
	startUtc: Iso;
	endUtc: Iso;
	/** When the last occurrence ends, or null for a series with no end. */
	seriesEndUtc: Iso | null;
	icalUid: string;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
	exceptions: CalendarException[];
}

export interface CalendarEventInput {
	title: string;
	startLocal: LocalDateTime;
	/** Left out: an hour after the start, or one day for an all-day event. */
	endLocal?: LocalDateTime;
	allDay?: boolean;
	/** Left out: the machine's zone. */
	timezone?: string;
	rrule?: string | null;
	notes?: string | null;
	location?: string | null;
	clientId?: string | null;
	projectId?: string | null;
}

export type CalendarEventPatch = Partial<CalendarEventInput>;

/** Where an edit or a removal of a recurring event applies. */
export interface CalendarEditTarget {
	scope: CalendarScope;
	/** Required for this and following: the occurrence the person is looking at. */
	occurrenceStartLocal?: LocalDateTime;
}

/** One occurrence of an event, as a range query returns it. */
export interface CalendarOccurrence {
	kind: "event";
	eventId: string;
	/** The key of this occurrence within its series. Equal to startLocal for a single event. */
	occurrenceStartLocal: LocalDateTime;
	title: string;
	notes: string | null;
	location: string | null;
	allDay: boolean;
	timezone: string;
	startLocal: LocalDateTime;
	endLocal: LocalDateTime;
	startUtc: Iso;
	endUtc: Iso;
	isRecurring: boolean;
	/** True when this occurrence was moved or edited on its own. */
	isException: boolean;
	rrule: string | null;
	recurrenceLabel: string;
	clientId: string | null;
	clientName: string | null;
	projectId: string | null;
	projectName: string | null;
}

/** A reminder shown on the grid. Read-only here; it is managed on the Reminders screen. */
export interface CalendarReminderItem {
	kind: "reminder";
	reminderId: string;
	title: string;
	dueOn: IsoDate;
	bucket: ReminderBucket;
	category: ReminderCategory;
	clientName: string | null;
}

/** A project deadline shown on the grid. Read-only here; it is managed on the client. */
export interface CalendarDeadlineItem {
	kind: "deadline";
	projectId: string;
	projectName: string;
	/** Null for a project that is not for a client. See ProjectSummary. */
	clientId: string | null;
	clientName: string | null;
	dueOn: IsoDate;
}

export type CalendarItem = CalendarOccurrence | CalendarReminderItem | CalendarDeadlineItem;

export interface CalendarRangeQuery {
	/** First calendar date of the range, inclusive. */
	from: IsoDate;
	/** Last calendar date of the range, inclusive. */
	to: IsoDate;
	/** The zone the dates are read in. Left out: the machine's zone. */
	timezone?: string;
	includeReminders?: boolean;
	includeDeadlines?: boolean;
	clientId?: string;
	projectId?: string;
}

export interface CalendarImportResult {
	created: number;
	updated: number;
	skipped: number;
	warnings: string[];
}

/**
 * A location match drawn from Juno's own data: a client's stored address, or a
 * location typed on a past event. No network involved, so this is safe to ask
 * for on every keystroke.
 */
export interface LocationSuggestion {
	source: "client" | "recent";
	/** What the list shows: a client's name, or the location text itself. */
	label: string;
	/** The full text that fills the field when this suggestion is picked. */
	address: string;
}

/** One match from an explicit, user-triggered lookup against OpenStreetMap. */
export interface AddressCandidate {
	label: string;
	lat: number;
	lon: number;
}

/* -------------------------------------------------------------------- agent */

/**
 * The confirmation gate, as the renderer sees it.
 *
 * A side-effectful tool call from an agent does not run. It parks as a pending
 * action carrying the arguments it would use, and a person approves or rejects
 * it in the app. See .claude/rules/mcp.md section 4.
 */
export type AgentActionState = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";

/** Where the request came from. Never "user": a person's own click is not a request. */
export type AgentActionSource = "mcp" | "assistant" | "automation";

export interface AgentAction extends Standard {
	toolName: string;
	/** The arguments as given. Shown in full before anybody approves. */
	args: Record<string, unknown>;
	/** One line describing what will happen, built when the action was made. */
	summary: string;
	state: AgentActionState;
	source: AgentActionSource;
	automationRunId: string | null;
	expiresAt: Iso;
	decidedAt: Iso | null;
	executedAt: Iso | null;
	/** What the service returned once it ran, JSON. */
	result: unknown;
	error: string | null;
}

export interface AgentActionListQuery {
	states?: AgentActionState[];
	limit?: number;
}

export type AuditActor = "user" | "agent" | "automation";
export type AuditResult = "ok" | "failed" | "pending" | "rejected" | "expired";

export interface AuditEvent extends Standard {
	actor: AuditActor;
	toolName: string;
	/** SHA-256 of the canonical arguments, shortened. No argument value is copied. */
	argsDigest: string;
	summary: string;
	result: AuditResult;
	entityType: string | null;
	entityId: string | null;
	actionId: string | null;
	error: string | null;
}

export interface AuditListQuery {
	actor?: AuditActor;
	toolName?: string;
	/** Only events at or after this instant. */
	since?: Iso;
	limit?: number;
}

/** What a tool is, for the screen that lists the surface an agent can drive. */
export interface ToolSummary {
	name: string;
	title: string;
	description: string;
	readOnly: boolean;
	/** True when a person has to approve each call before it runs. */
	requiresConfirmation: boolean;
	/**
	 * True when the service behind it holds its own gate, so the generic one
	 * would ask twice. `mail.send` is the only one (decision 22).
	 */
	gatedInService: boolean;
}

/* -------------------------------------------------------------- automations */

export type AutomationTrigger =
	| { kind: "manual" }
	| { kind: "daily"; time: string }
	/** `weekday` is 1 for Monday through 7 for Sunday, as ISO-8601 numbers them. */
	| { kind: "weekly"; weekday: number; time: string };

export interface AutomationStep {
	tool: string;
	args: Record<string, unknown>;
}

export interface Automation extends Standard {
	name: string;
	description: string | null;
	trigger: AutomationTrigger;
	steps: AutomationStep[];
	enabled: boolean;
	lastRunAt: Iso | null;
	lastRunOn: IsoDate | null;
	/** Filled by the service: how the last run ended. */
	lastStatus: AutomationRunStatus | null;
}

export interface AutomationInput {
	name: string;
	description?: string | null;
	trigger?: AutomationTrigger;
	steps: AutomationStep[];
	enabled?: boolean;
}

export type AutomationPatch = Partial<AutomationInput>;

export type AutomationRunStatus = "running" | "done" | "waiting" | "failed" | "cancelled";

export interface AutomationRunLogEntry {
	step: number;
	tool: string;
	/** ran, waiting, failed or skipped. */
	outcome: "ran" | "waiting" | "failed" | "skipped";
	at: Iso;
	/** The pending action this step is waiting on. */
	actionId?: string;
	/** Short, readable. The whole result is not copied into the log. */
	detail?: string;
}

export interface AutomationRun extends Standard {
	automationId: string;
	automationName: string;
	startedBy: "manual" | "schedule" | "agent";
	startedAt: Iso;
	finishedAt: Iso | null;
	status: AutomationRunStatus;
	log: AutomationRunLogEntry[];
	stoppedAtStep: number | null;
	error: string | null;
}

/* ---------------------------------------------------------------- briefings */

/** One thing worth knowing, with enough to click through to it. */
export interface BriefingItem {
	kind: "reminder" | "event" | "deadline" | "mail" | "document" | "outbox" | "action";
	id: string;
	title: string;
	detail: string | null;
	/** `YYYY-MM-DD` for anything with a date, null for a count or a state. */
	on: IsoDate | null;
	/** Set when this wants attention rather than simply being true. */
	urgent: boolean;
}

export interface BriefingSection {
	key: string;
	title: string;
	items: BriefingItem[];
	/** Shown when the section is empty, so an empty day still reads as an answer. */
	emptyText: string;
}

export interface Briefing {
	/** The day or range the briefing is about. */
	title: string;
	from: IsoDate;
	to: IsoDate;
	/** One sentence a person or an agent can read on its own. */
	headline: string;
	sections: BriefingSection[];
}

/* ----------------------------------------------------------- the MCP server */

/** What an agent client keeps its servers in. Codex is the one that is not JSON. */
export type AgentConfigFormat = "json" | "toml";

/**
 * An agent client on this machine, and where Juno stands with its MCP config.
 *
 * Two separate questions, because one answer used to stand for both and read
 * as the wrong one: `installed` is whether the client is on this machine, from
 * its own data folder or install directory, and `hasConfigFile` is whether the
 * file Juno would write already exists. A client that is installed but has
 * never had an MCP server added has no file yet, and writing it is exactly what
 * makes the client pick Juno up the next time it starts.
 */
export interface AgentClientTarget {
	id: string;
	name: string;
	/** Null when this client does not exist on this platform. */
	path: string | null;
	installed: boolean;
	hasConfigFile: boolean;
	/** Juno is in the file, under some settings. */
	configured: boolean;
	/** Juno is in the file with exactly the settings this install would write. */
	upToDate: boolean;
	format: AgentConfigFormat;
	/**
	 * The object or table the servers live under inside that client's file.
	 * VS Code calls it "servers", Codex calls it "mcp_servers", everyone else
	 * copied Claude Desktop and calls it "mcpServers".
	 *
	 * It is on the target rather than looked up by id in the renderer, because a
	 * second copy of this mapping is one that drifts the day a client renames
	 * its key, and the screen that would be wrong is the one telling a person
	 * where to paste something by hand.
	 */
	configKey: string;
	/** What the person has to do after the file changes, in one sentence. */
	after: string;
}

/** What a write to one agent client's configuration did. */
export interface AgentInstallResult {
	name: string;
	path: string;
	/** Where the previous file was copied, when there was one. */
	backupPath: string | null;
	created: boolean;
	after: string;
}

export interface McpServerStatus {
	/** False when the server could not start. Everything else is still true. */
	running: boolean;
	/** The named pipe or socket the bridge connects to. */
	address: string;
	/** How many agents are connected right now. */
	connections: number;
	/** The command an agent should be configured with. */
	command: string;
	args: string[];
	/**
	 * Environment the bridge needs. Empty in development; a packaged build has
	 * no Node beside it and runs the bridge through its own binary, which is
	 * what ELECTRON_RUN_AS_NODE does. Writing the entry without this produces a
	 * client that starts Juno's window instead of the bridge.
	 */
	env: Record<string, string>;
	/** The whole config block, ready to paste. */
	configJson: string;
	/** Why it is not running, when it is not. */
	error: string | null;
	toolCount: number;
}
