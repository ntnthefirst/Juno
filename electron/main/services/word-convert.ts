/**
 * Asks Microsoft Word or PowerPoint to save a file as PDF (decisions 77 and
 * 83), when the program is installed on this machine.
 *
 * Each program is driven through COM from a PowerShell script that is the same
 * text on every run. The two paths reach it as environment variables, never
 * as part of the script, so a file name with a quote or a `$` in it is only
 * ever a name. Both paths are built by a service, in a folder of its own;
 * nothing from the window or an agent reaches here. The program is closed in
 * a `finally`, and the run is stopped after its time limit, together with the
 * copy of the program it started, which a stopped script no longer closes.
 *
 * One run at a time, whichever program it asks. PowerPoint is one process per
 * session, so two runs at once would share it, and the first to finish would
 * quit it under the second. A preview and a Convert to PDF wait for each other
 * rather than race.
 *
 * No Electron import. Only `child_process`, so a test can ask whether Word is
 * there and skip the Word path when it is not.
 */
import { execFile } from "node:child_process";

/** Long enough for a large contract on a slow machine, short enough that a hung Word does not hang Juno. */
export const WORD_TIMEOUT_MS = 60_000;
/** A deck of pictures takes longer to write than a contract. */
export const POWERPOINT_TIMEOUT_MS = 90_000;

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

/**
 * The same for PowerPoint. ppSaveAsPDF is 32. Presentations.Open is asked for
 * read only (msoTrue is -1), with its name kept (Untitled msoFalse) and no
 * window (WithWindow msoFalse), so nothing appears on the person's screen.
 *
 * PowerPoint cannot be hidden, only left without a window, and it runs once
 * per session: COM hands back the person's own PowerPoint when it is open. A
 * PowerPoint with a window or a deck of its own is theirs, and only the deck
 * opened here is closed. ppAlertsNone (1) is set only on one this script
 * started.
 *
 * Macros are forced off before the file opens, as for Word. PowerPoint's Open
 * takes no password, but reads one after the name, `name::password::`: on a
 * deck without one it is ignored, and on a protected deck the open fails at
 * once instead of waiting on a question nobody can see.
 */
export const POWERPOINT_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"$app = $null",
	"$deck = $null",
	"$ours = $false",
	"$security = $null",
	"try {",
	"  $app = New-Object -ComObject PowerPoint.Application",
	"  $ours = ($app.Visible -eq 0) -and ($app.Presentations.Count -eq 0)",
	"  if ($ours) { $app.DisplayAlerts = 1 }",
	"  $security = $app.AutomationSecurity",
	"  $app.AutomationSecurity = 3",
	"  $deck = $app.Presentations.Open($env:JUNO_POWERPOINT_INPUT + '::juno-no-password::', -1, 0, 0)",
	"  $deck.SaveAs($env:JUNO_POWERPOINT_OUTPUT, 32)",
	"} finally {",
	"  if ($deck -ne $null) { try { $deck.Close() } catch {} ; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }",
	"  if ($app -ne $null -and $security -ne $null) { try { $app.AutomationSecurity = $security } catch {} }",
	"  if ($app -ne $null) {",
	"    if ($ours) { try { $app.Quit() } catch {} }",
	"    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)",
	"  }",
	"}",
].join("\n");

/** What differs between the two programs. Everything else about a run is the same. */
interface OfficeApp {
	/** As a person reads it in a sentence. */
	name: string;
	/** The COM class a script asks for, registered when the program is installed. */
	progId: string;
	/** The process the program runs as. */
	image: string;
	script: string;
	inputVariable: string;
	outputVariable: string;
	timeout: number;
}

const WORD: OfficeApp = {
	name: "Word",
	progId: "Word.Application",
	image: "WINWORD.EXE",
	script: WORD_SCRIPT,
	inputVariable: "JUNO_WORD_INPUT",
	outputVariable: "JUNO_WORD_OUTPUT",
	timeout: WORD_TIMEOUT_MS,
};

const POWERPOINT: OfficeApp = {
	name: "PowerPoint",
	progId: "PowerPoint.Application",
	image: "POWERPNT.EXE",
	script: POWERPOINT_SCRIPT,
	inputVariable: "JUNO_POWERPOINT_INPUT",
	outputVariable: "JUNO_POWERPOINT_OUTPUT",
	timeout: POWERPOINT_TIMEOUT_MS,
};

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

const detected = new Map<string, Promise<boolean>>();

/**
 * Whether a program is installed, read once from the registry: Office
 * registers its COM class's current version when it is. Never true off Windows.
 */
function installed(app: OfficeApp): Promise<boolean> {
	if (process.platform !== "win32") return Promise.resolve(false);
	let known = detected.get(app.progId);
	if (!known) {
		const pattern = new RegExp(app.progId.replace(".", "\\."), "i");
		known = run("reg.exe", ["query", `HKCR\\${app.progId}\\CurVer`], { timeout: 10_000 })
			.then((out) => pattern.test(out))
			.catch(() => false);
		detected.set(app.progId, known);
	}
	return known;
}

/** Whether Word is installed. */
export function wordInstalled(): Promise<boolean> {
	return installed(WORD);
}

/** Whether PowerPoint is installed. */
export function powerpointInstalled(): Promise<boolean> {
	return installed(POWERPOINT);
}

export interface RunningOffice {
	pid: number;
	commandLine: string;
}

/** Kept under the name it had when Word was the only program. */
export type RunningWord = RunningOffice;

/**
 * The copies of a program to stop after a run was stopped: started for a
 * program (COM starts Office with `/Automation`), and not running before the
 * run began. One the person opened has no `/Automation` and is never one of
 * them.
 */
export function officeToStop(before: ReadonlySet<number>, running: RunningOffice[]): number[] {
	return running
		.filter((office) => !before.has(office.pid) && /(^|\s)[/-]automation(\s|$)/i.test(office.commandLine))
		.map((office) => office.pid);
}

/** The same rule, under the name the Word tests know it by. */
export const wordsToStop = officeToStop;

/** Every process of one image with its command line. Empty when there is none or the list cannot be read. */
async function runningCopies(image: string): Promise<RunningOffice[]> {
	const list = `Get-CimInstance Win32_Process -Filter "Name='${image}'" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`;
	try {
		const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", list], { timeout: 15_000 });
		return out
			.split(/\r?\n/)
			.map((line) => {
				const [pid, ...rest] = line.split("\t");
				return { pid: Number.parseInt(pid ?? "", 10), commandLine: rest.join("\t") };
			})
			.filter((office) => Number.isInteger(office.pid) && office.pid > 0);
	} catch {
		return [];
	}
}

/**
 * Stops the copy a stopped run left behind. Stopping PowerShell does not stop
 * the program it asked COM for, which then sits hidden, often in front of a
 * question nobody can see, until the machine restarts. Looked for twice,
 * because one still starting when the run stopped appears a moment later.
 */
async function stopLeftover(image: string, before: ReadonlySet<number>): Promise<void> {
	for (const wait of [0, 3000]) {
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		for (const pid of officeToStop(before, await runningCopies(image))) {
			try {
				process.kill(pid);
			} catch {
				// Already gone.
			}
		}
	}
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs one conversion after the ones already asked for, whatever became of them. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
	const next = queue.then(work, work);
	queue = next.catch(() => undefined);
	return next;
}

async function convertWith(app: OfficeApp, inputPath: string, outputPath: string): Promise<void> {
	const before = new Set((await runningCopies(app.image)).map((office) => office.pid));
	try {
		await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", app.script], {
			env: { ...process.env, [app.inputVariable]: inputPath, [app.outputVariable]: outputPath },
			timeout: app.timeout,
		});
	} catch (cause) {
		const timedOut = (cause as { killed?: boolean }).killed === true;
		if (timedOut) await stopLeftover(app.image, before);
		const limit = app.timeout === 60_000 ? "a minute" : `${Math.round(app.timeout / 1000)} seconds`;
		throw new Error(
			timedOut
				? `${app.name} took longer than ${limit} to make the PDF, so Juno stopped it. Open the file in ${app.name} to check it opens without a question, then try again.`
				: `${app.name} could not make a PDF of this file. Open it in ${app.name} to check it opens, then try again.`,
		);
	}
}

/** Converts one file to PDF through Word. Throws a sentence when Word fails or takes too long. */
export function convertWithWord(inputPath: string, outputPath: string): Promise<void> {
	return inTurn(() => convertWith(WORD, inputPath, outputPath));
}

/** Converts one deck to PDF through PowerPoint. Throws a sentence when PowerPoint fails or takes too long. */
export function convertWithPowerPoint(inputPath: string, outputPath: string): Promise<void> {
	return inTurn(() => convertWith(POWERPOINT, inputPath, outputPath));
}
