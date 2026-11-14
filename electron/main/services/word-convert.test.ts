/**
 * The script that drives Word (decision 77). Word itself runs only in the
 * opt-in test in document-working.test.ts; these check what the script asks
 * of it, and that PowerShell can read it at all, without starting Word.
 */
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { WORD_SCRIPT } from "./word-convert";

describe("the Word script", () => {
	it("forces macros off before the file opens, and puts the setting back", () => {
		const off = WORD_SCRIPT.indexOf("$word.AutomationSecurity = 3");
		const open = WORD_SCRIPT.indexOf("$word.Documents.Open(");
		expect(off).toBeGreaterThan(-1);
		expect(off).toBeLessThan(open);
		expect(WORD_SCRIPT.indexOf("$word.AutomationSecurity = $security")).toBeGreaterThan(open);
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
