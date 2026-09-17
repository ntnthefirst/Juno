# Security rules

Bureau holds a business's mail passwords, client records and signed contracts on
one machine. These rules are strict because the blast radius is the whole company.

---

## 1. Credentials live in `safeStorage` and nowhere else

Decision 6 in [../../docs/decisions.md](../../docs/decisions.md).

- Mail passwords, app passwords and OAuth tokens go through
  `electron/main/vault/`, which wraps Electron `safeStorage` (Windows DPAPI, macOS
  Keychain), keyed by account id.
- **The database stores a reference, never a secret.** `mail_accounts` has a
  `credential_key`, not a password column. If a secret can appear in a `SELECT`,
  it is in the wrong place.
- **The renderer never receives a credential.** There is no IPC channel and no MCP
  tool that returns one, not even masked. The renderer says "sync account X" and
  "store this password I just typed"; it never says "give me the password".
- Every network call that uses a credential is made in the main process.
- Entering a password is a one-way trip: the input posts the value to the main
  process, the main process stores it, the renderer clears the field. Never echo it
  back to prefill a settings form. Show "set" or "not set".
- `safeStorage.isEncryptionAvailable()` is checked before the first write. If it
  returns false, refuse to store the credential and tell the user why. Do not fall
  back to plaintext.

## 2. The preload bridge is a fixed list of channels

`electron/preload/index.ts` exposes one frozen object through `contextBridge`, and
that object is the entire surface the renderer has.

May expose: named, typed functions that map to one IPC channel each
(`clients.list`, `mail.syncAccount`, `documents.render`).

May not expose, ever:

- `ipcRenderer` itself, or any function taking a channel name as an argument. A
  generic `invoke(channel, args)` makes every handler reachable from any injected
  script and turns the allowlist into a formality.
- `require`, `process`, `fs`, `child_process`, a path, or anything returning a
  node object.
- A function that takes a SQL string, a file path chosen by the renderer, or a URL
  the main process will fetch. Pass an id and let the service resolve it.

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`. None of these gets turned off to make an import work. If a
renderer import needs node, the import is wrong ([architecture.md](architecture.md)).

## 3. Serve the renderer over a custom scheme, not `file://`

`file://` has a null origin, which breaks a real CSP, breaks `localStorage`
partitioning and makes every relative fetch a surprise.

- Register a privileged scheme (`app://`) before `app.whenReady()`, mark it
  `standard` and `secure`, and serve the built renderer from it. The window loads
  `app://bureau/index.html` in production and the Vite dev server in development.
- Ship a real CSP as a response header on that scheme, not only as a meta tag:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none';
  base-uri 'none'`.
- No `'unsafe-eval'`. If a dependency needs it, replace the dependency.
- Fonts are bundled and loaded from `'self'` (decision 10). No Google Fonts link,
  no CDN, no remote stylesheet.
- `setWindowOpenHandler` denies everything by default and opens genuine external
  links with `shell.openExternal` after checking the protocol is `https:`. Never
  pass a URL that came from an email straight to `shell.openExternal`.
- Block or ignore `will-navigate` to anything that is not the app scheme.

## 4. Fetched email HTML is hostile input

Treat every message body as an attacker's file that happens to be addressed to
the user.

- Render it in a **sandboxed iframe**: `sandbox="allow-same-origin"` at most,
  never `allow-scripts`, never `allow-top-navigation`, never `allow-popups`. The
  frame gets its own restrictive CSP.
- Sanitise before rendering, in the main process, with a maintained sanitiser
  (DOMPurify is the obvious choice and decisions.md does not name one). Strip
  `<script>`, `<iframe>`, `<object>`, `<form>`, every `on*` attribute, and
  `javascript:` and `data:` URLs in `href`.
- **No remote images by default.** Remote content is a read receipt and an IP leak.
  Rewrite `src` to a placeholder and offer a per-message "load images" action that
  the user clicks. Never a global default-on setting.
- Links inside a message open externally after the protocol check in section 3,
  and the real target is shown to the user, not the anchor text.
- Attachments are written to disk with a sanitised filename, never executed, never
  auto-opened. Strip path separators from the name a message supplies.
- The same applies to `.ics` invitations and any HTML a client sends. Parse, do
  not evaluate.

## 5. Never log a secret

- No password, token, cookie, full message body or attachment content in a log
  line, a thrown error message, a stack trace, or a crash report.
- `imapflow` and `nodemailer` can log at a level that includes the auth exchange.
  Keep their loggers off in production and never at debug with a real account.
- Log an account by id, never by address plus password. Log an error class and a
  message, not the request object.
- No `console.log` in committed code ([writing.md](writing.md)). A log a developer
  left in is a log that ships to a user's machine.
- Crash and telemetry reporting is off. This app is local-first and there is
  nothing to report to (decision 5).

## 6. Build config versus runtime data

Decision 6 is explicit, and it decides where things belong.

| Build configuration | Runtime data |
| --- | --- |
| Code-signing certificate, update-feed URL | Mail accounts, passwords, tokens |
| App id, product name, icon | Client records, documents, calendar |
| Nothing else | Everything else |

- **No `.env` with an account in it, no `electron-builder` entry, no CI secret.**
  Accounts are typed in by the user at runtime and stored in `safeStorage`.
- No test account committed in a fixture, a seed script, a comment or a screenshot.
- The signing certificate lives outside the repo and reaches CI as an encrypted
  secret. It is never a file in the tree.

## 7. Documents and signing

- A signature image plus timestamp plus audit trail (decision 8). **Do not write
  UI copy, a document footer or documentation claiming this is a qualified
  electronic signature under eIDAS.** It is not.
- The audit page records what was signed, when, by whom and a hash of the source
  file. Store the hash in the DB so a tampered PDF is detectable.
- Generated documents are written under the userData root with a path the service
  builds from an id. A path supplied by the renderer or by an agent is never
  joined onto a filesystem root without validating it stays inside that root.
- Anything that signs, sends, files or deletes requires explicit confirmation and
  never fires unattended. See [mcp.md](mcp.md) section 4.

## 8. The lock is three layers, and only one of them is a lock screen

Decision 15 in [../../docs/decisions.md](../../docs/decisions.md). Be precise
about what each layer buys, because a lock screen over an unencrypted file is
theatre.

| Layer | Protects against | Does not protect against |
| --- | --- | --- |
| OS account, always on | Another person's login on the same machine | Anyone holding the machine while the owner is signed in |
| Lock screen, optional, default on | Someone walking up to the running, unlocked laptop | Anything done to `bureau.db` on disk |
| Database encryption, optional, off by default | A stolen machine or a copied file | A running, unlocked Bureau. The key is in memory while unlocked |

- **Lock state lives in the main process.** It is the only place that knows
  whether Bureau is locked. Every IPC handler and every MCP tool checks it before
  it does anything, and a renderer claiming to be unlocked proves nothing: a
  renderer that believes it is locked is a renderer that can be told it is not.
- **A PIN is never the key-derivation input for encryption.** The encryption key
  is random, generated once, and stored wrapped by `safeStorage`. A passphrase, a
  PIN or a biometric unwraps it. A four-digit PIN fed straight into a KDF is
  brute-forceable offline in seconds, and the indirection that avoids this costs
  one step.
- Unlock methods: passphrase with Argon2id and a per-install random salt, with the
  parameters stored alongside; PIN, rate-limited with an escalating lockout, and
  convenience only; Touch ID through `systemPreferences.promptTouchID()`. Windows
  Hello needs a native module and is the last one built, not the first.
- **Locking drops state, it does not only draw over it.** Sensitive renderer state
  is discarded rather than hidden behind an overlay, mail sync pauses, and no
  background job resumes until a person has re-authenticated. A screenshot of a
  locked window must not contain a client record.
- Lock triggers: idle timeout, OS lock or sleep, minimise (optional), and manually.
- **The settings screen states in one plain sentence that the lock screen does not
  protect the file on disk.** Not a tooltip, not a help page. Copy that implies
  otherwise is a bug in the same class as claiming an eIDAS signature (section 7).
- Turning encryption on requires the passphrase twice and states, in those words,
  that a forgotten passphrase means the data is unrecoverable and there is no reset.
- An MCP tool may lock Bureau and may never unlock it. There is no `app.unlock`
  ([mcp.md](mcp.md), PLAN.md section 4). Unlocking is a person at the keyboard.
