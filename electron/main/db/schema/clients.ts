import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { seededColumns, standardColumns } from "../columns";

/**
 * A client is an organisation Juno does work for. Everything else that matters
 * hangs off it: contacts, projects, documents and eventually mail threads.
 */
export const clients = sqliteTable(
	"clients",
	{
		...standardColumns,
		name: text("name").notNull(),
		/** Lowercased name, kept for case-insensitive sort and lookup. */
		sortName: text("sort_name").notNull(),
		statusId: text("status_id").references(() => referenceItems.id),
		website: text("website"),
		vatNumber: text("vat_number"),
		/** Free text, Markdown. Rendered like a calendar event's notes. */
		notes: text("notes"),
	},
	(t) => [
		index("clients_owner_idx").on(t.ownerId),
		index("clients_sort_name_idx").on(t.sortName),
		index("clients_status_idx").on(t.statusId),
		index("clients_deleted_idx").on(t.deletedAt),
	],
);

/**
 * A client can have more than one of these, because a real business does: a
 * general address, one for invoices, one a contact prefers. `label` is free
 * text ("Facturatie", "Kantoor Leuven") rather than a fixed set, because the
 * set a client actually needs is not one Juno can predict. Exactly one row
 * should carry `isPrimary`, enforced in the service the same way a contact's
 * primary flag is.
 */
export const clientEmails = sqliteTable(
	"client_emails",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		email: text("email").notNull(),
		label: text("label"),
		isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
	},
	(t) => [
		index("client_emails_client_idx").on(t.clientId),
		index("client_emails_owner_idx").on(t.ownerId),
		index("client_emails_email_idx").on(t.email),
		index("client_emails_deleted_idx").on(t.deletedAt),
	],
);

export const clientPhones = sqliteTable(
	"client_phones",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		phone: text("phone").notNull(),
		label: text("label"),
		isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
	},
	(t) => [
		index("client_phones_client_idx").on(t.clientId),
		index("client_phones_owner_idx").on(t.ownerId),
		index("client_phones_deleted_idx").on(t.deletedAt),
	],
);

export const clientAddresses = sqliteTable(
	"client_addresses",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		/** "Kantoor Leuven", "Magazijn". Not required: most clients have one address. */
		label: text("label"),
		addressLine1: text("address_line1").notNull(),
		addressLine2: text("address_line2"),
		postalCode: text("postal_code"),
		city: text("city"),
		country: text("country"),
		isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
	},
	(t) => [
		index("client_addresses_client_idx").on(t.clientId),
		index("client_addresses_owner_idx").on(t.ownerId),
		index("client_addresses_deleted_idx").on(t.deletedAt),
	],
);

export const contacts = sqliteTable(
	"contacts",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		name: text("name").notNull(),
		role: text("role"),
		email: text("email"),
		phone: text("phone"),
		/** Exactly one contact per client should carry this. Enforced in the service. */
		isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
		notes: text("notes"),
	},
	(t) => [
		index("contacts_client_idx").on(t.clientId),
		index("contacts_owner_idx").on(t.ownerId),
		index("contacts_email_idx").on(t.email),
		index("contacts_deleted_idx").on(t.deletedAt),
	],
);

export const projects = sqliteTable(
	"projects",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		name: text("name").notNull(),
		statusId: text("status_id").references(() => referenceItems.id),
		description: text("description"),
		/** Dates without a time are stored as YYYY-MM-DD, not as a UTC instant. */
		startsOn: text("starts_on"),
		dueOn: text("due_on"),
		/** Integer cents. Never a float, and never a decimal string. */
		agreedValueCents: integer("agreed_value_cents"),
		notes: text("notes"),
	},
	(t) => [
		index("projects_client_idx").on(t.clientId),
		index("projects_owner_idx").on(t.ownerId),
		index("projects_status_idx").on(t.statusId),
		index("projects_due_idx").on(t.dueOn),
		index("projects_deleted_idx").on(t.deletedAt),
	],
);

/**
 * Reference data, per decision 16. A set is a named list ("client_status",
 * "label"); an item is one value in it. Shipped rows carry a seed key and are
 * hidden rather than deleted, because records already point at them.
 */
export const referenceSets = sqliteTable(
	"reference_sets",
	{
		...standardColumns,
		/** Stable machine key: client_status, project_status, document_status, label. */
		key: text("key").notNull(),
		label: text("label").notNull(),
		description: text("description"),
		/** A set the user may add items to. Some sets are fixed by code. */
		allowsCustomItems: integer("allows_custom_items", { mode: "boolean" })
			.notNull()
			.default(true),
	},
	(t) => [index("reference_sets_key_idx").on(t.key)],
);

export const referenceItems = sqliteTable(
	"reference_items",
	{
		...standardColumns,
		...seededColumns,
		setId: text("set_id")
			.notNull()
			.references(() => referenceSets.id),
		/** Stable machine key within the set: active, lead, draft, signed. */
		key: text("key").notNull(),
		label: text("label").notNull(),
		/** A token name from brand/tokens.css, never a hex value. */
		tone: text("tone"),
	},
	(t) => [
		index("reference_items_set_idx").on(t.setId),
		index("reference_items_hidden_idx").on(t.hiddenAt),
	],
);

/**
 * Something that happened with a client, written down by hand.
 *
 * The timeline is otherwise assembled from records that already exist: a
 * document was generated, a thread arrived, an appointment was kept. A phone
 * call leaves no record at all, and it is often the one that mattered, so this
 * is the row for "I called them on Tuesday and they want the roof done in
 * March".
 *
 * `happenedAt` is when the thing happened, which is not `createdAt`, when it
 * was typed in. A call remembered on Friday still belongs on Tuesday, and the
 * timeline sorts on the first of those.
 */
export const clientNotes = sqliteTable(
	"client_notes",
	{
		...standardColumns,
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id),
		/** UTC ISO-8601, like every instant in this database. */
		happenedAt: text("happened_at").notNull(),
		/**
		 * call, meeting, note. Drives an icon and nothing else, which is why it is
		 * a plain column rather than a reference set: a value the user could hide
		 * would take rows with it and nothing would gain by that.
		 */
		kind: text("kind").notNull().default("note"),
		title: text("title").notNull(),
		/** Free text, Markdown, like a client's notes field. */
		body: text("body"),
	},
	(t) => [
		index("client_notes_client_idx").on(t.clientId, t.happenedAt),
		index("client_notes_owner_idx").on(t.ownerId),
		index("client_notes_deleted_idx").on(t.deletedAt),
	],
);
