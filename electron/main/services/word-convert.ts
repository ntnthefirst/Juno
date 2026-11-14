/**
 * Asks Microsoft Word to save a file as PDF (decision 77), when Word is
 * installed on this machine.
 *
 * Word is driven through COM from a PowerShell script that is the same text on
 * every run. The two paths reach it as environment variables, never as part of
 * the script, so a file name with a quote or a `$` in it is only ever a name.
 * Both paths are built by the conversion service under the documents folder;
 * nothing from the window or an agent reaches here. Word is closed in a
 * `finally`, and the run is stopped after a minute, together with the Word it
 * started, which a stopped script no longer closes.
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
	// A password the file does not have, for opening and for writing: Word
	// ignores it on a file without one, and on a protected file it fails at
	// once instead of asking in a window nobody can see. Then the format is
	// worked out by Word, the document is not shown, and no encoding is asked.
	"  $nopass = 'juno-no-password'",
	"  $missing = [System.Type]::Missing",
	"  $doc = $word.Documents.Open($env:JUNO_WORD_INPUT, $false, $true, $false, $nopass, $nopass, $false, $nopass, $nopass, 0, $missing, $false, $false, $missing, $true)",
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

export interface RunningWord {
	pid: number;
	commandLine: string;
}

/**
 * The Words to stop after a run was stopped: started for a program (COM
 * starts Word with `/Automation`), and not running before the run began. A
 * Word the person opened has no `/Automation` and is never one of them.
 */
export function wordsToStop(before: ReadonlySet<number>, running: RunningWord[]): number[] {
	return running
		.filter((word) => !before.has(word.pid) && /(^|\s)[/-]automation(\s|$)/i.test(word.commandLine))
		.map((word) => word.pid);
}

/** Every WINWORD with its command line. Empty when there is none or the list cannot be read. */
async function runningWords(): Promise<RunningWord[]> {
	const list =
		"Get-CimInstance Win32_Process -Filter \"Name='WINWORD.EXE'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
	try {
		const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", list], { timeout: 15_000 });
		return out
			.split(/\r?\n/)
			.map((line) => {
				const [pid, ...rest] = line.split("\t");
				return { pid: Number.parseInt(pid ?? "", 10), commandLine: rest.join("\t") };
			})
			.filter((word) => Number.isInteger(word.pid) && word.pid > 0);
	} catch {
		return [];
	}
}

/**
 * Stops the Word a stopped run left behind. Stopping PowerShell does not stop
 * the Word it asked COM for, which then sits hidden, often in front of a
 * question nobody can see, until the machine restarts. Looked for twice,
 * because a Word still starting when the run stopped appears a moment later.
 */
async function stopLeftoverWord(before: ReadonlySet<number>): Promise<void> {
	for (const wait of [0, 3000]) {
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		for (const pid of wordsToStop(before, await runningWords())) {
			try {
				process.kill(pid);
			} catch {
				// Already gone.
			}
		}
	}
}

/** Converts one file to PDF through Word. Throws a sentence when Word fails or takes too long. */
export async function convertWithWord(inputPath: string, outputPath: string): Promise<void> {
	const before = new Set((await runningWords()).map((word) => word.pid));
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
		if (timedOut) await stopLeftoverWord(before);
		throw new Error(
			timedOut
				? "Word took longer than a minute to make the PDF, so Juno stopped it. Open the file in Word to check it opens without a question, then try again."
				: "Word could not make a PDF of this file. Open it in Word to check it opens, then try again.",
		);
	}
}
