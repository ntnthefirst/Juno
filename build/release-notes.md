# Release notes

Newest first. The rules for writing an entry are in `.claude/rules/release-notes.md`.

## 1.4.0
Released: 2026-11-20

Mail has an Outbox for what is still on its way, and its status is one line.

### New
- Outbox, after Sent in Mail, holds every message waiting to go out or that failed to go.
- Drafts can be ticked together and sent or deleted in one go.
- A reply still in Outbox shows in the conversation, in red when it did not go.

### Improvements
- The status at the foot of the mail folders is one line with a green, yellow or red dot. Click it to see each part.
- Drafts lists only drafts. A message waiting for approval, queued or failed is in Outbox.

### Fixes
- A draft open in the editor used to stay on screen when you clicked another folder.

## 1.3.2
Released: 2026-11-19

Two fixes for adding a mail account.

### Fixes
- A new mail account with only an inbox used to stay without Drafts, Sent or Trash, which Juno makes on the next sync.
- The mail icon in the Address field of Add mail account used to sit on top of the text.

## 1.3.1
Released: 2026-11-16

A file's preview works like a real viewer: zoom, scroll, select and copy, with Word and PowerPoint shown page by page.

### New
- Word files and PowerPoint decks preview page by page with their real layout, made by Word or PowerPoint on your computer.
- Every preview zooms with Ctrl and the wheel, Ctrl plus or minus, or the buttons above it, and Ctrl 0 fits it again.
- Text in a PDF, a text file or a Word file can be selected and copied, and Ctrl F finds a word in it.
- Cells in a spreadsheet preview can be selected and copied with Ctrl C, ready to paste into Excel.
- A picture in a preview can be copied with Ctrl C or its right-click menu, and dragged around once you zoom in.
- Pages, Keynote and Numbers files show their words under the cover picture, so you can read and copy them.

### Improvements
- Open and Convert to PDF are small icon buttons in the preview, and Sign moved to its "..." menu.
- A PDF preview says which page you are on, and a second look at a Word file or deck opens at once.

## 1.3.0
Released: 2026-11-16

Documents live with their client or project, your own files have a place called Files, and files copy and paste like in Explorer.

### New
- Files in the sidebar holds your own files that belong to no client or project, such as a price list or your terms.
- Each client and project has a Documents tab with every file, page and signed document kept for it.
- Files copy and paste with Ctrl C and Ctrl V, also from Explorer, and pasted text or a picture becomes a file.
- Select files like in Explorer with Ctrl, Shift, Ctrl A and the arrow keys, and duplicate one with Ctrl D.
- Space previews a Word file, workbook, PDF or picture inside Juno, and Enter opens it in its own app.
- A new version of a file marks the words it adds and leaves out compared with the one before.
- A mail attachment saves to the conversation's project in one click, and any attachment can be previewed first.
- A message waiting in the outbox can be edited or deleted before it is sent.
- Juno copies your data before an update changes it, and says so at launch if that copy failed.
- Names of clients, projects and events in a line of text open that record when clicked.

### Improvements
- Document templates are gone: write a contract in Word or as a page and keep it on the client's Documents tab.
- Documents left the sidebar and moved to the Documents tab of each client and project.
- Every file shows the icon of its type, in documents, project files and mail attachments.
- New in Mail and Calendar opens a menu with what each of them can start.
- A mail you open is marked read at once, and the server hears it at the next sync.
- Lists and cards show the shape of what is loading instead of the word.
- Escape steps back from a settings page instead of closing Settings.

### Fixes
- Deleting a note straight after typing used to lose the last keystrokes.
- A reminder ticked in two places at once used to skip an occurrence.
- The agenda used to show 00:00 on the later days of an event that ends late.
- A resized event in the week view used to be saved twice.
- A refused email address or phone number used to vanish from its field.
- The palette used to say Nothing matches before its lists had loaded.

## 1.2.0
Released: 2026-11-08

Adding a mail account takes a few clicks, calendars can be subscribed to, and every list can select rows together.

### New
- Adding a mail account starts from a list of providers, finds the servers from your address and tests both directions before saving.
- Settings, Mail accounts can subscribe to a calendar by its address, such as Google's secret iCal address, and shows it read only.
- Clients, projects and notes can be selected together to mail, archive, duplicate or delete them at once.
- A new event or reminder opens in one window with a switch between the two, a client and project picker, and formatted notes.
- Reminders can have a time of day as well as a date.
- A client's details are edited in place on its page: double-click a value to change it, and notes save as you type.
- Each list's search is in the title bar, and Ctrl F puts the cursor in it.

### Improvements
- The title bar shows the page title on the left, and the bell and the agent open a dropdown instead of a screen.
- The calendar slides whole months and weeks into place like a scroll, without a flash.
- Unread mail is marked by an iris shape behind the sender's picture, and every picture lines up.
- A client's page has Send mail, Log call and New project in the title bar.
- The mail reader's top bar is smaller, with reply, forward, flag and trash side by side.
- Intros and outros are plain text, written as you want them to read.
- Colours have more contrast, and weekends and days outside the month stand out in the calendar.
- Events are saved in your computer's time zone, so the time zone field is gone.

### Fixes
- Tooltips near the edge of the window used to be cut off.
- The tick for selecting a mail used to sit beside its picture instead of on it.

## 1.1.0
Released: 2026-11-08

Juno shows what changed in every version, and select all in Mail takes every matching conversation.

### New
- Settings has a Release notes page with what changed in every version of Juno.
- Settings, Updates shows what an update changes before you install it.

### Improvements
- Select all in Mail takes every conversation that matches the folder, filters and search, not only the ones on screen.
- Mail offers to link a conversation to the client's open project, even when the mail does not name the project.
- Changing the theme repaints the whole window at once, the title bar buttons included.
- The Clients list and the client picker show their clients as soon as they open.

### Fixes
- Mail and an open page used to keep redrawing in the background, which made them feel slow.

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
