/**
 * Asks Microsoft Word to save a file as PDF (decision 77), when Word is
 * installed on this machine.
 *
 * Word is driven through COM from a PowerShell script that is the same text on
 * every run. The two paths reach it as environment variables, never as part of
 * the script, so a file name with a quote or a `$` in it is only ever a name.
 * Both paths are built by the conversion service under the documents folder;
 * nothing from the window or an agent reaches here. Word is closed in a
 * `finally`, and the run is stopped after a minute.
 *
 * No Electron import. Only `child_process`, so a test can ask whether Word is
 * there and skip the Word path when it is not.
 */
import { execFile } from "node:child_process";

/** Long enough for a large contract on a slow machine, short enough that a hung Word does not hang Juno. */
export const WORD_TIMEOUT_MS = 60_000;

/**
 * wdFormatPDF is 17. Documents.Open is asked for read only, with no conversion
 * prompt and no recent-files entry; SaveAs2 writes the PDF; the document is
 * closed without saving whatever happens before.
 *
 * COM can hand back a Word the person already has open rather than a new one.
 * One that is on screen or has documents open is theirs: it is not hidden and
 * not quit, and only the document opened here is closed. A Word this script
 * started is quit in the `finally`.
 *
 * A file opened through COM runs its macros unless Word is told otherwise:
 * AutomationSecurity defaults to "enable all" for a program, whatever the
 * person's own Trust Center says. A `.docm` or `.doc` from a mail would run its
 * AutoOpen macro the moment it was converted, so macros are forced off before
 * the file opens, and the setting is put back afterwards for a Word that is the
 * person's.
 */
export const WORD_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"$word = $null",
	"$doc = $null",
	"$ours = $false",
	"$security = $null",
	"try {",
	"  $word = New-Object -ComObject Word.Application",
	"  $ours = (-not $word.Visible) -and ($word.Documents.Count -eq 0)",
	"  if ($ours) { $word.Visible = $false; $word.DisplayAlerts = 0 }",
	// msoAutomationSecurityForceDisable.
	"  $security = $word.AutomationSecurity",
	"  $word.AutomationSecurity = 3",
	"  $doc = $word.Documents.Open($env:JUNO_WORD_INPUT, $false, $true, $false)",
	"  $doc.SaveAs2($env:JUNO_WORD_OUTPUT, 17)",
	"} finally {",
	// Opened read only and never changed, so closing asks nothing. A number
	// passed for Close's or Quit's optional by-reference argument fails in
	// PowerShell and leaves Word running hidden, so neither is given one.
	"  if ($doc -ne $null) { try { $doc.Close() } catch {} ; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }",
	"  if ($word -ne $null -and $security -ne $null) { try { $word.AutomationSecurity = $security } catch {} }",
	"  if ($word -ne $null) {",
	"    if ($ours) { try { $word.Quit() } catch {} }",
	"    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)",
	"  }",
	"}",
].join("\n");

function run(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeout: number }): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{ env: options.env ?? process.env, timeout: options.timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (error) reject(error);
				else resolve(String(stdout));
			},
		);
	});
}

let detected: Promise<boolean> | null = null;

/**
 * Whether Word is installed, read once from the registry: Word registers
 * `Word.Application` for COM when it is. Never true off Windows.
 */
export function wordInstalled(): Promise<boolean> {
	if (process.platform !== "win32") return Promise.resolve(false);
	detected ??= run("reg.exe", ["query", "HKCR\\Word.Application\\CurVer"], { timeout: 10_000 })
		.then((out) => /Word\.Application/i.test(out))
		.catch(() => false);
	return detected;
}

/** Converts one file to PDF through Word. Throws a sentence when Word fails or takes too long. */
export async function convertWithWord(inputPath: string, outputPath: string): Promise<void> {
	try {
		await run(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WORD_SCRIPT],
			{
				env: { ...process.env, JUNO_WORD_INPUT: inputPath, JUNO_WORD_OUTPUT: outputPath },
				timeout: WORD_TIMEOUT_MS,
			},
		);
	} catch (cause) {
		const timedOut = (cause as { killed?: boolean }).killed === true;
		throw new Error(
			timedOut
				? "Word took longer than a minute to make the PDF. Close any Word window that is asking something, then try again."
				: "Word could not make a PDF of this file. Open it in Word to check it opens, then try again.",
		);
	}
}
