/**
 * The system clipboard, for clipboard.ts.
 *
 * Electron reads text and pictures itself. Files are the hard part: Chromium
 * reads only the first file Explorer copied (the `FileNameW` format), and
 * cannot write the list Explorer pastes from (`CF_HDROP`). So on Windows both
 * go through PowerShell's own Get-Clipboard and Set-Clipboard, in a script
 * whose text never changes; the paths go in and come out as data, never as
 * part of the script (the same rule as the Word conversion, decision 77).
 * The quick check for files is Electron's, so a paste of text or a picture
 * never starts PowerShell at all.
 */
import { execFile } from "node:child_process";
import { clipboard, nativeImage } from "electron";
import type { SystemClipboard } from "./clipboard";

const READ_FILES =
	"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
	"$f = Get-Clipboard -Format FileDropList -ErrorAction SilentlyContinue; " +
	"if ($f) { $f | ForEach-Object { $_.FullName } }";

const WRITE_FILES =
	"$p = @($env:JUNO_CLIPBOARD_FILES -split [char]10 | Where-Object { $_ }); " +
	"if ($p.Count -gt 0) { Set-Clipboard -LiteralPath $p }";

const TIMEOUT_MS = 10_000;

function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
			{ windowsHide: true, timeout: TIMEOUT_MS, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});
}

/** The first file Explorer copied, as Chromium sees it. Empty when there are no files. */
function firstFile(): string {
	try {
		return clipboard.readBuffer("FileNameW").toString("utf16le").replace(/\0+$/, "").split("\0")[0] ?? "";
	} catch {
		return "";
	}
}

export const systemClipboard: SystemClipboard = {
	async readFiles() {
		const first = firstFile();
		if (!first) return [];
		if (process.platform !== "win32") return [first];
		try {
			const listed = (await powershell(READ_FILES))
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			return listed.length > 0 ? listed : [first];
		} catch {
			// PowerShell missing or blocked: the first file still pastes.
			return [first];
		}
	},
	readImage() {
		const image = clipboard.readImage();
		return image.isEmpty() ? null : new Uint8Array(image.toPNG());
	},
	readText() {
		return clipboard.readText();
	},
	hasContent() {
		return firstFile() !== "" || clipboard.availableFormats().some((format) => format.startsWith("image/")) || clipboard.readText().trim() !== "";
	},
	writeImage(bytes) {
		const image = nativeImage.createFromBuffer(Buffer.from(bytes));
		if (image.isEmpty()) return false;
		clipboard.writeImage(image);
		return true;
	},
	async writeFiles(paths) {
		if (process.platform !== "win32" || paths.length === 0) return false;
		try {
			await powershell(WRITE_FILES, { JUNO_CLIPBOARD_FILES: paths.join("\n") });
			return firstFile() !== "";
		} catch {
			return false;
		}
	},
};
