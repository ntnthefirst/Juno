/**
 * The script that drives Word (decision 77). Word itself runs only in the
 * opt-in test in document-working.test.ts; these check what the script asks
 * of it, and that PowerShell can read it at all, without starting Word.
 */
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { POWERPOINT_SCRIPT, WORD_SCRIPT, wordsToStop } from "./word-convert";

describe("the PowerPoint script", () => {
	it("forces macros off before the deck opens, and puts the setting back", () => {
		const off = POWERPOINT_SCRIPT.indexOf("$app.AutomationSecurity = 3");
		const open = POWERPOINT_SCRIPT.indexOf("$app.Presentations.Open(");
		expect(off).toBeGreaterThan(-1);
		expect(off).toBeLessThan(open);
		expect(POWERPOINT_SCRIPT.indexOf("$app.AutomationSecurity = $security")).toBeGreaterThan(open);
	});

	it("opens read only with no window, fails on a password at once, and saves as PDF", () => {
		expect(POWERPOINT_SCRIPT).toMatch(/Presentations\.Open\(\$env:JUNO_POWERPOINT_INPUT \+ '::juno-no-password::', -1, 0, 0\)/);
		expect(POWERPOINT_SCRIPT).toMatch(/SaveAs\(\$env:JUNO_POWERPOINT_OUTPUT, 32\)/);
	});

	it("quits only a PowerPoint it started, never the person's own", () => {
		expect(POWERPOINT_SCRIPT).toMatch(/\$ours = \(\$app\.Visible -eq 0\) -and \(\$app\.Presentations\.Count -eq 0\)/);
		expect(POWERPOINT_SCRIPT).toMatch(/if \(\$ours\) \{ try \{ \$app\.Quit\(\) \}/);
		const powerpoint = '"C:\\Program Files\\Microsoft Office\\Root\\Office16\\POWERPNT.EXE"';
		const running = [
			{ pid: 11, commandLine: `${powerpoint} /AUTOMATION -Embedding` },
			{ pid: 12, commandLine: `${powerpoint} "C:\\Users\\An\\Voorstel.pptx"` },
		];
		expect(wordsToStop(new Set(), running)).toEqual([11]);
	});

	it.runIf(process.platform === "win32")(
		"is a script PowerShell parses without an error",
		async () => {
			const parse =
				"$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:JUNO_SCRIPT, [ref]$null, [ref]$errors); $errors.Count";
			const out = await new Promise<string>((resolve, reject) =>
				execFile(
					"powershell.exe",
					["-NoProfile", "-NonInteractive", "-Command", parse],
					{ env: { ...process.env, JUNO_SCRIPT: POWERPOINT_SCRIPT }, windowsHide: true, timeout: 30_000 },
					(error, stdout) => (error ? reject(error) : resolve(String(stdout))),
				),
			);
			expect(out.trim()).toBe("0");
		},
		60_000,
	);
});

describe("the Word script", () => {
	it("forces macros off before the file opens, and puts the setting back", () => {
		const off = WORD_SCRIPT.indexOf("$word.AutomationSecurity = 3");
		const open = WORD_SCRIPT.indexOf("$word.Documents.Open(");
		expect(off).toBeGreaterThan(-1);
		expect(off).toBeLessThan(open);
		expect(WORD_SCRIPT.indexOf("$word.AutomationSecurity = $security")).toBeGreaterThan(open);
	});

	it("gives Word a password to fail on, so a protected file never waits on a hidden prompt", () => {
		expect(WORD_SCRIPT).toMatch(
			/Documents\.Open\(\$env:JUNO_WORD_INPUT, \$false, \$true, \$false, \$nopass, \$nopass, \$false, \$nopass, \$nopass,/,
		);
	});

	it("stops only a Word started for a program after the run began, never the person's own", () => {
		const word = '"C:\\Program Files\\Microsoft Office\\Root\\Office16\\WINWORD.EXE"';
		const running = [
			{ pid: 10, commandLine: `${word} /Automation -Embedding` },
			{ pid: 20, commandLine: `${word} /Automation -Embedding` },
			{ pid: 30, commandLine: word },
			{ pid: 40, commandLine: `${word} "C:\\Users\\An\\Offerte.docx"` },
		];
		expect(wordsToStop(new Set([10]), running)).toEqual([20]);
		expect(wordsToStop(new Set(), [{ pid: 50, commandLine: `${word} /n` }])).toEqual([]);
	});

	it.runIf(process.platform === "win32")(
		"is a script PowerShell parses without an error",
		async () => {
			const parse =
				"$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:JUNO_SCRIPT, [ref]$null, [ref]$errors); $errors.Count";
			const out = await new Promise<string>((resolve, reject) =>
				execFile(
					"powershell.exe",
					["-NoProfile", "-NonInteractive", "-Command", parse],
					{ env: { ...process.env, JUNO_SCRIPT: WORD_SCRIPT }, windowsHide: true, timeout: 30_000 },
					(error, stdout) => (error ? reject(error) : resolve(String(stdout))),
				),
			);
			expect(out.trim()).toBe("0");
		},
		60_000,
	);
});
