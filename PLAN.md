# Bureau: build plan

The order the thing gets built in, and why that order. Read
[docs/decisions.md](docs/decisions.md) first: this plan assumes every decision in
it and never overrides one.

---

## 1. What Bureau is

A local-first Electron desktop app holding the back office of a one-person
business. Clients and projects, contracts generated from the Word templates that
already exist, paperwork reminders, mail from several IMAP accounts pulled into
local SQLite, and a calendar. The SQLite file is the source of truth and the app
works with the network off. Every capability is a service function, so the UI and
an AI agent get it on the same day.

### What it is not

| Not | Because |
| --- | --- |
| An invoicing tool | Decision 9. Bureau reminds and tracks what is owed; the accounting tool invoices. Requirements vary by country and change yearly, for no gain. |
| A payments tool | It never moves money and never holds a payment credential. |
| A cloud app | No server, no account, no subscription. Anything remote syncs into local state, never a read the UI blocks on. |
| A qualified eIDAS signature | Signature image plus timestamp plus audit trail (decision 8). High-stakes contracts keep going through a provider. |
| A product | It is Nathan's tool. A second user is a research input, not a roadmap. |

---

## 2. The phases

Ordered by pain relieved, not by architecture. **The rule that governs the cut:
each phase must be worth using alone.** If a phase only pays off once a later one
lands, the cut is wrong and it gets re-cut before it is built. Atlas died at phase
7 of a plan whose phases were layers; these are tools.

A **session** is one focused evening, roughly 3 hours. Calendar ranges assume 2 to
4 sessions a week and that some weeks have none. MCP tools ship **with** the
feature, from phase 0 on. Phase 6 adds the assistant and the cross-domain tools;
it is not where MCP starts.

### Phase 0: shell, database, clients

**Goal:** replace the spreadsheet and the scattered folders with one window that
knows who the clients are.

- **Ships:** Electron + React + TS + Vite shell mirroring `parrel-cockpit-desktop`, `brand/tokens.css` wired in light and dark. Theme as a three-state setting, `system` / `light` / `dark`, applied by `data-theme` on `<html>` and `nativeTheme.themeSource` together (decision 14). Drizzle schema carrying the five mandatory columns, migrations running forward on launch. `client`, `contact`, `project`: CRUD, search, soft delete with undo. The seeded reference-data framework (decision 16), with statuses and labels usable from day one: editable, reorderable, hideable rather than deletable, resettable per set. Lock screen, on by default, with passphrase (Argon2id) and PIN, lock state owned by the main process (decision 15). Owner profile in settings (company name, VAT, address), because phase 1 needs it. Backup and restore. Packaging and auto-update.
- **Deferred:** network calls of any kind, dashboard, tags, attachments, import, multi-owner UI. Windows Hello and Touch ID unlock, and database encryption, which is section 6 for now.
- **Size:** 12 to 17 sessions, 5 to 7 weeks, up from 8 to 12 because the lock screen and the seeded reference-data framework were added to this phase. Driven by how much of the Parrel shell lifts rather than gets rewritten, by getting a signed build updating before anything is stacked on it, and by the key wrapping behind the PIN, which is little code and careful review.
- **Done when:** Nathan opens the packaged app on his own machine, enters bodhi, hyge, noir and obet with their contacts and live projects, renames a project status to the word he actually uses, reboots, opens it again, unlocks it with his passphrase and finds all of it there in the theme he chose. He then deletes the spreadsheet.

Packaging belongs here, not later. An app that only runs under `npm run dev` is
not shippable to yourself, and every later phase inherits the build.

### Phase 1: documents and signing

**Goal:** an NDA that took twenty minutes of find-and-replace takes one minute and
cannot contain last client's name.

- **Ships:** `document_template` registry over the existing `.docx` files (NDA/geheimhouding, ontwikkelovereenkomst, hosting & service overeenkomst, project scope / MVP definitie, addendum), a placeholder convention, and a linter flagging what the app cannot fill. The document types themselves are seeded reference data from phase 0 (decision 16), so adding a type or renaming one is a settings edit, not a migration. docxtemplater generation from client, project and owner profile, with a fill form for the rest. Output as `.docx` and PDF. pdf-lib stamping: signature PNG, UTC timestamp, document hash, appended audit page. The signing screen states in plain Dutch what this signature is and is not.
- **Deferred:** sending it (export and attach by hand for now), client countersigning in-app, in-app template editing (they stay Word files, decision 8), version diffs.
- **Size:** 12 to 18 sessions, 5 to 8 weeks. Driven almost entirely by the templates: reworking the Dutch `.docx` files into clean placeholders without breaking the legal text or Word's formatting is careful manual work, not code. Budget a third of the phase for it.
- **Done when:** Nathan picks obet and ontwikkelovereenkomst, fills three fields, gets a PDF with his signature on it, and sends it from his normal mail client without editing anything.

### Phase 2: reminders

**Goal:** stop discovering in March that something was due in January.

- **Ships:** `reminder`, one-off and recurring, attached to a client, project, document or nothing. Seeded rules for the paperwork that actually recurs: VAT quarter, social contributions, hosting renewals, contract end dates. "Time to invoice" reminders derived from project state, pointing at the accounting tool by name and URL and generating nothing. A Today view, snooze and complete, and an OS notification on launch and daily.
- **Deferred:** calendar rendering (phase 5 reads these), email notification, full dashboard, amount tracking.
- **Size:** 5 to 8 sessions, 2 to 3 weeks. Driven by recurrence: keep to a small fixed pattern set (every N days/weeks/months, nth weekday, quarter end) and refuse anything wider. The general case is phase 5's problem, and phase 5 has `rrule` for it.
- **Done when:** Nathan opens Bureau on a Monday and it tells him something he had forgotten, before he had to remember it. A month later he has missed no deadline and checked no separate list.

### Phase 3: email, read-only

**Goal:** all accounts in one local searchable archive that knows which client a
thread belongs to.

- **Ships:** `mail_account` with credentials in `safeStorage`, never in the database or the renderer (decision 6). imapflow sync in the main process: folder list, UID-based incremental fetch, headers then bodies, mailparser into `mail_message`, threading by `Message-ID` / `In-Reply-To` / `References`. Attachments to disk. Three-pane reader with sanitised HTML in a locked-down view. FTS5 search. Client linking by sender address with manual override. A sync status UI honest about what failed.
- **Deferred:** sending, drafts, flags and moves written back, folder management, invites. Any IMAP write at all.
- **Size:** 25 to 40 sessions, 10 to 16 weeks. Largest phase by a wide margin, and the range is wide because IMAP servers disagree with each other and with the RFCs. Drivers: a full first sync of a large mailbox without freezing the app or exhausting memory, resuming an interrupted sync, `UIDVALIDITY` changing and invalidating local state, Gmail versus a normal Dovecot host, encoding and MIME edge cases, HTML sanitisation done properly.
- **Done when:** Nathan pulls the wifi, opens Bureau, searches a phrase he knows is in an old hyge thread, finds it and reads it. He then stops opening the webmail tab to look things up.

This is where the project dies if it dies. It gets sub-shipped rather than
attempted whole; see section 5.

### Phase 4: email sending and HTML templates

**Goal:** send the contract phase 1 generated, from inside the app, in the house
style.

- **Ships:** nodemailer SMTP per account with a real outbox (queued, sending, sent, failed, retry). Compose in plain text and HTML, reply and reply-all that thread correctly, attach a `document` row in two clicks. `mail_template` with variables filled from client and project, rendered against the brand tokens: contract cover, project kickoff, invoice-due nudge, hosting renewal. Append to the IMAP Sent folder so the phone shows it. Send always requires explicit confirmation, human or agent.
- **Deferred:** rich text beyond a small fixed toolbar, scheduled send, mail merge. Read receipts and tracking pixels, permanently.
- **Size:** 10 to 16 sessions, 4 to 7 weeks. Drivers: deliverability (SPF, DKIM and DMARC alignment on his own domains), HTML email surviving Outlook, and reconciling sent messages with what phase 3 later pulls back down so nothing appears twice.
- **Done when:** Nathan generates an ontwikkelovereenkomst, attaches it, sends it to a real client from inside Bureau, and it looks right on his phone and in the client's Outlook.

### Phase 5: calendar

**Goal:** deadlines, reminders and appointments on one grid, offline.

- **Ships:** `calendar_event` with `rrule` recurrence and an IANA timezone per event. Month, week and agenda views. Phase 2 reminders and project deadlines as read-only overlays. `.ics` import and export via `ical.js`. Drag to move and resize, with the recurrence question asked properly (this occurrence / this and following / all). Link an event to a client or project.
- **Deferred:** CalDAV two-way sync (additive, later, decision 11), invitations and attendee responses, free/busy, shared calendars.
- **Size:** 12 to 18 sessions, 5 to 8 weeks. Drivers: recurrence expansion with exceptions (`EXDATE`, `RECURRENCE-ID`) is where correctness gets expensive, and DST makes a stored-UTC-only model wrong for recurring local-time events.
- **Done when:** Nathan schedules a recurring Tuesday client call, moves one occurrence, exports the month to `.ics`, opens it elsewhere, and the moved occurrence sits in the right place after the October DST change.

### Phase 6: the wide MCP surface and the assistant

**Goal:** ask the business a question and let it act, within limits it cannot
exceed.

- **Ships:** cross-domain MCP tools no single phase owned: search across clients, mail, documents and events, plus briefing and digest tools. An in-app assistant panel driving the same surface an external agent uses. `automation` and `automation_run`: a recorded sequence of service calls with a trigger, replayable, logged, cancellable. A confirmation gate on every side-effectful tool and a persistent audit log of what an agent did. The real dashboard, now that there is something to aggregate.
- **Deferred:** agents acting unattended while the app is closed; anything sending mail or money without a human press; any cloud model requirement, since the app must work with no key configured.
- **Size:** 12 to 20 sessions, 5 to 8 weeks, and open-ended by nature. Driven by how clean the services layer stayed. If decision 2 held, most of this is declarations and a UI. If logic leaked into IPC handlers, it becomes a refactor first.
- **Done when:** Nathan types "what do I owe paperwork on this month, and which clients have a contract ending before December", gets a correct answer he can verify by clicking through, and opened no screen himself.

### Order rationale

| Phase | Pain it removes | Usable alone? |
| --- | --- | --- |
| 0 | Client data in four places | Yes. It is the address book. |
| 1 | Twenty minutes and a copy-paste risk per contract | Yes, with no other phase present. |
| 2 | Missed deadlines | Yes. Needs only phase 0's rows. |
| 3 | Searching four webmails | Yes, once one account syncs. |
| 4 | Leaving the app to send what it made | Yes, given 3. |
| 5 | Deadlines with no shape | Yes, given 0 and 2. |
| 6 | Doing all of it by hand | Yes, incrementally, per tool. |

---

## 3. Data model sketch

Not DDL. Every table carries the five from decision 4: `id` (UUIDv7), `owner_id`,
`created_at`, `updated_at`, `deleted_at`, timestamps UTC ISO-8601. Omitted below
to keep the sketch readable.

| Table | Key columns | Note |
| --- | --- | --- |
| `client` | `name`, `legal_name`, `vat_number`, `address`, `country`, `status`, `notes` | root. Has many contacts, projects, documents, threads, reminders |
| `contact` | `client_id`, `name`, `email`, `phone`, `role`, `is_primary` | `email` is what mail linking matches |
| `project` | `client_id`, `name`, `kind`, `status`, `started_at`, `deadline_at`, `rate`, `currency` | has many documents, reminders, events |
| `document_template` | `key`, `label_nl`, `file_path`, `placeholders` (json), `kind`, `version` | source for `document`. A seeded set, so it also carries the decision 16 columns |
| `document` | `template_id`, `client_id`, `project_id`, `title`, `status`, `docx_path`, `pdf_path`, `content_hash`, `fill_values` (json), `signed_at` | client required, project optional |
| `document_signature` | `document_id`, `signer_name`, `image_path`, `signed_at`, `document_hash`, `audit` (json) | the hash is what makes the audit page mean anything |
| `mail_account` | `label`, `email`, `imap_host/port`, `smtp_host/port`, `security`, `credential_ref`, `last_sync_at`, `sync_state` | `credential_ref` points into `safeStorage`. **No secret here.** |
| `mail_folder` | `account_id`, `path`, `delimiter`, `uid_validity`, `uid_next`, `role` | `uid_validity` invalidates a resume |
| `mail_message` | `account_id`, `folder_id`, `thread_id`, `uid`, `message_id`, `in_reply_to`, `references`, `from_address`, `to_addresses`, `subject`, `sent_at`, `body_text`, `body_html`, `flags` | FTS5 over subject and `body_text` |
| `mail_thread` | `subject_norm`, `client_id`, `last_message_at`, `message_count`, `link_source` (auto/manual) | `link_source` protects a manual override from the next sync |
| `mail_attachment` | `message_id`, `filename`, `mime_type`, `size`, `file_path` | on disk, not in SQLite |
| `mail_template` | `key`, `label`, `subject`, `body_html`, `variables` (json) | phase 4 compose. A seeded set, so it also carries the decision 16 columns |
| `outbox_message` | `account_id`, `state`, `payload` (json), `attempts`, `last_error`, `sent_at`, `appended_to_sent_at` | the send queue, separate until sent |
| `calendar_event` | `title`, `starts_at`, `ends_at`, `all_day`, `timezone`, `rrule`, `exdates`, `recurrence_id`, `parent_event_id`, `client_id`, `project_id`, `ics_uid` | self-referencing for overridden occurrences |
| `reminder` | `title`, `due_at`, `rrule`, `status`, `snoozed_until`, `completed_at`, `kind`, `client_id`, `project_id`, `document_id`, `link_url` | polymorphic by nullable FKs, not a generic entity table |
| `automation` | `name`, `trigger` (json), `steps` (json: service calls), `enabled`, `last_run_at` | a recorded call sequence, never a second engine |
| `automation_run` | `automation_id`, `started_at`, `finished_at`, `status`, `log` (json) | one per execution |
| `audit_event` | `actor` (user/agent), `tool_name`, `args_digest`, `entity_type`, `entity_id`, `result`, `occurred_at` | written by every side-effectful service call |
| `reference_set` | `key`, `label`, `seed_version` | one row per seeded set: document types, statuses, labels, reminder presets, email templates |
| `reference_item` | `set_id`, `seed_key`, `label`, `value` (json), `is_system`, `hidden_at`, `sort_order`, `customised_at` | decision 16. Removing sets `hidden_at`; nothing here is ever hard-deleted |
| `setting` | `key`, `value` (json) | owner profile, signature PNG path, sync intervals |

Four things that matter more than the columns:

- `reminder` and `calendar_event` stay separate. A reminder is a thing you owe; an
  event is a block of time. Merging them makes both worse.
- `mail_thread.client_id` is the point of phase 3. It turns an archive into a
  client record.
- Soft deletes mean every query filters `deleted_at IS NULL`. Put that in a shared
  query helper in phase 0, not in 200 call sites later.
- Theme and lock are not tables. The theme belongs to the installation rather than
  to the data (decision 14), lock state belongs to the main process (decision 15),
  and the encryption key is wrapped by `safeStorage`, never stored in a row.

---

## 4. MCP tool surface

Named `domain.verb`. Read-only tools run freely. Side-effectful tools require
explicit confirmation, whether the caller is the assistant panel or an external
agent. The service function is the implementation; the MCP file declares and
delegates, nothing more (decision 2).

| Phase | Tool | Kind | Confirm |
| --- | --- | --- | --- |
| 0 | `clients.list/get/search`, `contacts.list/get`, `projects.list/get` | read | no |
| 0 | `clients.create/update/archive`, `contacts.create/update/delete`, `projects.create/update/setStatus` | write | yes |
| 0 | `settings.get_theme`, `reference.list/get` | read | no |
| 0 | `settings.set_theme` | write, local display only | no |
| 0 | `reference.create/update/hide/restore/reorder` | write | yes |
| 0 | `reference.reset` | write, discards customisation | yes, listing what it will restore |
| 0 | `app.lock` | write, local | no. Locking is always the safe direction |
| 1 | `templates.list/inspect`, `documents.list/get/preview` | read | no |
| 1 | `documents.generate/renderPdf/setStatus/void` | write, writes files | yes |
| 1 | `documents.sign` | write | yes, and never silently |
| 2 | `reminders.list/due/get` | read | no |
| 2 | `reminders.create/complete/snooze/delete` | write | yes |
| 3 | `mail.accounts.list`, `mail.sync_status`, `mail.search`, `mail.threads.list`, `mail.thread.get`, `mail.message.get` | read | no |
| 3 | `mail.sync` | write, local only | no, but rate limited |
| 3 | `mail.accounts.add/update`, `mail.thread.linkClient/unlinkClient` | write | yes |
| 4 | `mail.templates.list/render`, `mail.outbox.list` | read | no |
| 4 | `mail.draft` | write, local | no |
| 4 | `mail.send` | write, external | **yes. Human press, no exceptions.** |
| 4 | `mail.outbox.cancel/retry` | write | yes |
| 5 | `calendar.list/get/agenda/freeBusy/export` | read | no |
| 5 | `calendar.create/update/move/delete/import` | write | yes |
| 6 | `search.global`, `briefing.today/client/month`, `automations.list/get/runs`, `audit.list` | read | no |
| 6 | `automations.create`, `automations.update`, `automations.run`, `automations.disable` | write | yes |

`mail.send`, `documents.sign` and any automation composing them are the tools
worth being paranoid about. An agent may prepare them completely and may never
fire them.

**There is no `app.unlock`, and there will not be.** A tool that can unlock Bureau
makes the lock screen decorative, because anything that can talk to the MCP server
can then open the app. Locking is exposed, unlocking is a person at the keyboard.

---

## 5. Risks, and what this plan does about them

| Risk | Honest assessment | Defusal |
| --- | --- | --- |
| **Phase 3 is where this dies** | An IMAP client is one of the hardest things a solo developer can choose to build. Servers disagree, the RFCs have corners, and the work is long and invisible for weeks. Ten to sixteen weeks is not pessimism. | Sub-ship it. 3a: one account, INBOX only, a readable list. 3b: all accounts and folders. 3c: search. 3d: client linking. Each is usable alone. Phases 0 to 2 are daily tools before 3 starts, so a stalled 3 leaves a working app, not a dead repo. If 3a passes six weeks, stop and reconsider, including not building it. |
| **Recurrence and timezones** | Recurrence with exceptions plus DST is a classic source of silent wrongness, and a subtly wrong calendar is worse than none. | Phase 2 uses a small fixed pattern set and refuses the general case. Phase 5 uses `rrule` and stores an IANA timezone per event, not UTC alone. Its done-when test is a DST-crossing recurring event, because that is the bug. |
| **Legal weight of the signature** | A PNG plus a timestamp is not a qualified electronic signature. Treating it as one turns a real dispute into a bad afternoon. | Decision 8 is binding. The UI states plainly what the signature is. `document_signature` hashes the signed bytes, so tampering is detectable. High-stakes contracts go through a provider, and the signing screen says so. |
| **Scope creep. Atlas stalled at phase 7.** | Highest-probability risk here, above any technical one. The failure pattern is a plan whose phases are layers. | Every phase has a done-when written as an observable act and removes a pain that exists today. Test for a new idea: name the phase it ships in and the evening deferring it stops being fine. No such phase means section 6. |
| **Generalising too early** | Building for imagined users adds settings, abstractions and migrations with nobody to validate them. | `owner_id` is the only concession, four columns of foresight (decision 4). Everything else stays specific to Nathan's business until a second real person is blocked. A second user is a bug report, not a feature request. |
| **Services layer erosion** | Phase 6 is cheap only if decision 2 held. Logic leaking into an IPC handler stays invisible until the MCP tool needs it. | The MCP tool ships with the feature, from phase 0. If a service is awkward to declare as a tool, the service is wrong and gets fixed then, the only time it is cheap. |
| **Credential handling** | A mail password in the database or the renderer is the one security mistake here that matters. | Decision 6. `mail_account` stores a `credential_ref`. No IPC method returns a secret. No account data in the build, `.env` or CI. |
| **A lock screen mistaken for encryption** | A lock screen over a plain SQLite file protects against a walk-up and nothing else. Someone who believes it protects the file will take the laptop places, and hand it to a repair shop, on a promise the app never made. | Decision 15 names the three layers separately, and the settings screen states in one plain sentence that the lock screen does not protect the file on disk. Encryption is a separate switch with its own warning. The PIN never derives the key: the key is random and wrapped by `safeStorage`, so a four-digit PIN is not an offline brute-force target. |
| **A seeded-data reset destroying customisation** | Reset is the one settings button that can quietly throw away real work: renamed statuses, a chosen order, rows hidden on purpose. And a reset that also deletes the user's own labels is not a reset, it is data loss. | Decision 16. Reset is per set before it is global, states which rows it will restore before it runs, and asks separately what to do with user-created rows. An upgrade never touches a row with `customised_at` set and never resurrects a hidden one. Because removing hides rather than deletes, the documents pointing at an old status survive every one of these paths. |
| **Data loss** | One SQLite file, one machine, no cloud backup by definition. | Backup and restore ship in phase 0, not later. |
| **Mail store size** | Four accounts with years of history and attachments is gigabytes. | Attachments on disk. Bodies after headers. A per-folder sync horizon, so the first sync can be bounded to recent mail and extended later. |

---

## 6. Explicitly out of scope

| Thing | Reason |
| --- | --- |
| Invoice generation, numbering, sending | Decision 9. Requirements vary by country and change; a reminder pointing at the accounting tool carries none of them. |
| Any movement of money | Same. Bureau never holds a payment credential. |
| Time tracking, accounting, ledgers, VAT returns | A tool exists for the first and is used; the rest is regulated, audited and the accountant's job. |
| A web or mobile version | The promise is a local file and no server. A different product with a different threat model. |
| Multi-user, roles, permissions | One owner. `owner_id` exists so this stays possible, not so it gets built. |
| Cloud sync between machines | Wanted eventually, and large. UUIDv7, `owner_id` and `deleted_at` keep the door open; nothing else is spent on it. |
| CalDAV two-way sync | Decision 11: import before sync. Additive after phase 5. |
| Database encryption at rest | Optional and off by default (decision 15), and additive whenever the threat becomes a stolen machine. It replaces `better-sqlite3` with `better-sqlite3-multiple-ciphers`, a native dependency swap that would put rebuild and packaging risk into phase 0 in exchange for protection phase 0 does not need. The lock screen ships in phase 0; this does not. |
| Read receipts, open and link tracking | Will not be built. |
| Calendar invitations and attendee replies | The iTIP flow is a phase of its own and the pain is small: send an `.ics`. |
| Writing flags, moves or deletes back to IMAP | Phase 3 is read-only on purpose. A read bug costs a redownload; a write bug costs mail. |
| In-app editing of the `.docx` templates | Legal text, editable in Word by decision 8. A worse editor inside Bureau is a downgrade. |
| Publishing, licensing, a website, other users | Decision 13: the licence is deliberately undecided. Nothing ships publicly until Bureau has been the daily tool for months and that question has an answer. |
| A required cloud AI model | The app opens, syncs and works with no API key configured. The assistant is additive. |
