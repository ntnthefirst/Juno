# Release notes

Newest first. The rules for writing an entry are in `.claude/rules/release-notes.md`.

## 1.0.0
Released: 2026-11-07

Juno 1.0 adds Notes and pages, a rebuilt Overview and mailbox rules. Small windows now open for new records, and agents get permission levels you set.

### New
- Notes and pages have their own place in the rail, with links and pictures in a page.
- The Overview shows what is overdue and waiting, a Coming up agenda and your unread mail.
- Mailbox rules file incoming mail for you, per account, with a history of what each rule did.
- Mail offers a reminder under a message that asks for something by a day or promises to follow up.
- Time entries and a timer in the title bar track the hours you spend on a project.
- You can choose how much an agent may do on its own, under Settings, MCP, Permissions.
- Intro and outro blocks can be added to a message from the composer.
- A client can have a language: Dutch, Dutch informal, French or English.
- Toasts have buttons, and Juno shows a tray menu, a taskbar badge and a global shortcut on Windows.
- Documents can be built from reusable components placed by reference.

### Improvements
- A new event, client, project or reminder opens in a small window instead of a full page.
- Right-click menus on records are now the menus your system draws.
- Every client is listed, not only the first 200, and long lists scroll smoothly.
- Search and Recent sit in the title bar, and the palette groups its commands.
- The calendar, the client record, the project record and the settings window follow the new design.
- You can find text inside an open message, and links show their real address when you hover.
- A signature stamp lands in the right place on pages that are turned a quarter turn.
- Messages open only https links.

### Fixes
- Juno no longer suggests an invoice reminder, because it does not invoice.
- Agent tokens are kept when the connection store cannot be read.

## 0.3.32
Released: 2026-10-21

Conversations can now be filed under a project, and agent clients connect by address only.

### New
- A mail conversation can be linked to a project and read from the project.

### Improvements
- Agent clients connect by URL. Juno no longer writes their configuration files.

### Fixes
- Agent tokens survive a failed read of the connection store.

## 0.3.31
Released: 2026-10-20

You can attach any file from your computer to a message.

### New
- Attach any file to a mail, not only documents already in Juno.
- Add an existing document to a client or a project.

## 0.3.30
Released: 2026-10-14

Mail is easier to follow and Juno keeps running in the background.

### New
- Mail shows a status line and offers undo after a move.
- Styled mail opens as a column beside the mailbox.
- Juno keeps running when you close the window, so an agent can still reach it.

### Improvements
- Dropped mail connections are retried on their own.
- Folders open from their names, and mail rows have cleaner hover states.
- The rail is slimmer and the agent button moved up.
- Linked template pictures load after you confirm the source.

## 0.3.29
Released: 2026-10-13

Mail templates fill more of themselves in.

### New
- A template input can fill from the linked client or project.

### Fixes
- Mail template previews have the right size, and remote pictures show a placeholder.

## 0.3.28
Released: 2026-10-13

Juno has a new look at the edges: icon, loading screen and empty states.

### New
- A loading screen shows while Juno opens.
- Empty screens explain what to do next and name the shortcut.

### Improvements
- The application icon, the installer artwork and the welcome page use the new bureau drawing.

## 0.3.27
Released: 2026-10-11

A fix for the Claude Desktop connection.

### Fixes
- The Claude Desktop connection starts again when Juno is loaded by the built-in runner.

## 0.3.26
Released: 2026-10-11

Documents and mail templates are easier to place.

### New
- A document can belong to a client, a project, both or nothing.
- A project page has a notes section.

### Improvements
- A project opens from the Projects tab of a client.
- A mail template opens on a page of its own.
- A mail template fills in only what it asks for.

## 0.3.25
Released: 2026-10-10

Claude Desktop joins the list of agent clients you can connect.

### New
- Claude Desktop can be connected from the MCP page, through an extension that links to Juno.
