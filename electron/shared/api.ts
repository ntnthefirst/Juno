/**
 * The contract the preload bridge exposes on `window.bureau`.
 *
 * This is the single definition of what the renderer can ask for. The main
 * process implements it in `electron/main/ipc/`, the preload forwards it, and
 * the renderer consumes it. All three typecheck against this file.
 *
 * What is deliberately absent:
 * - Anything that returns a secret. The renderer can ask to unlock; it can never
 *   read what it is unlocking with.
 * - Any raw SQL. The renderer never sees the database.
 *
 * Every method is async because it crosses a process boundary, even where the
 * service behind it is synchronous.
 */
import type {
	AppInfo,
	AppSettings,
	BackupInfo,
	Client,
	ClientInput,
	ClientPatch,
	ClientSummary,
	Contact,
	ContactInput,
	ContactPatch,
	LockSettings,
	LockState,
	Project,
	ProjectInput,
	ProjectPatch,
	ProjectSummary,
	ReferenceItem,
	ReferenceItemInput,
	ReferenceItemPatch,
	ReferenceSetKey,
	ReferenceSetWithItems,
	ReferenceUsage,
	ResetResult,
	ResetUserItems,
	SearchHit,
	ThemeSetting,
	OwnerProfile,
} from "./types";

export interface ListClientsQuery {
	search?: string;
	statusId?: string | null;
	includeDeleted?: boolean;
	limit?: number;
	offset?: number;
}

export interface BureauApi {
	app: {
		info(): Promise<AppInfo>;
	};

	clients: {
		list(query?: ListClientsQuery): Promise<ClientSummary[]>;
		get(id: string): Promise<Client | null>;
		create(input: ClientInput): Promise<Client>;
		update(id: string, patch: ClientPatch): Promise<Client>;
		/** Soft delete. Returns the row so the interface can offer an undo. */
		remove(id: string): Promise<Client>;
		restore(id: string): Promise<Client>;
	};

	contacts: {
		listForClient(clientId: string): Promise<Contact[]>;
		create(input: ContactInput): Promise<Contact>;
		update(id: string, patch: ContactPatch): Promise<Contact>;
		remove(id: string): Promise<Contact>;
		restore(id: string): Promise<Contact>;
		/** Clears the flag on every sibling, so exactly one can hold it. */
		setPrimary(id: string): Promise<Contact>;
	};

	projects: {
		list(query?: { clientId?: string; statusId?: string | null }): Promise<ProjectSummary[]>;
		get(id: string): Promise<Project | null>;
		create(input: ProjectInput): Promise<Project>;
		update(id: string, patch: ProjectPatch): Promise<Project>;
		remove(id: string): Promise<Project>;
		restore(id: string): Promise<Project>;
	};

	reference: {
		listSets(): Promise<ReferenceSetWithItems[]>;
		getSet(key: ReferenceSetKey): Promise<ReferenceSetWithItems | null>;
		createItem(input: ReferenceItemInput): Promise<ReferenceItem>;
		updateItem(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem>;
		/** Hide, never delete. Records already point at it. See decision 16. */
		hideItem(id: string): Promise<ReferenceItem>;
		unhideItem(id: string): Promise<ReferenceItem>;
		/** How many live records reference this item. Drives the warning in the UI. */
		usage(id: string): Promise<ReferenceUsage>;
		reorder(setId: string, orderedIds: string[]): Promise<ReferenceItem[]>;
		resetSet(key: ReferenceSetKey, userItems: ResetUserItems): Promise<ResetResult>;
		resetAll(userItems: ResetUserItems): Promise<ResetResult>;
	};

	settings: {
		get(): Promise<AppSettings>;
		getTheme(): Promise<ThemeSetting>;
		/** Also sets nativeTheme.themeSource, or the title bar disagrees with the window. */
		setTheme(theme: ThemeSetting): Promise<ThemeSetting>;
		getOwner(): Promise<OwnerProfile>;
		setOwner(patch: Partial<OwnerProfile>): Promise<OwnerProfile>;
	};

	lock: {
		state(): Promise<LockState>;
		getSettings(): Promise<LockSettings>;
		setSettings(patch: Partial<LockSettings>): Promise<LockSettings>;
		/** Sets or replaces the secret. Requires the current one once configured. */
		configure(input: {
			method: "passphrase" | "pin";
			secret: string;
			currentSecret?: string;
		}): Promise<LockState>;
		disable(currentSecret: string): Promise<LockState>;
		lock(): Promise<LockState>;
		/** The only way in. There is no MCP equivalent, by design. */
		unlock(secret: string): Promise<import("./types").UnlockResult>;
		/** Fires when the main process locks on its own: idle, sleep, minimise. */
		onChange(listener: (state: LockState) => void): () => void;
	};

	backup: {
		create(): Promise<BackupInfo>;
		list(): Promise<BackupInfo[]>;
		/** Replaces the live database. The app restarts afterwards. */
		restore(path: string): Promise<void>;
		revealFolder(): Promise<void>;
	};

	search: {
		global(term: string, limit?: number): Promise<SearchHit[]>;
	};
}

declare global {
	interface Window {
		bureau: BureauApi;
	}
}
