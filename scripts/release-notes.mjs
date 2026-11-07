/**
 * Writes build/release-notes-latest.md: the entry of build/release-notes.md for
 * the version in package.json. electron-builder reads that file into the release
 * feed (electron-builder.yml, releaseInfo), so an installed copy can show what
 * an update changes before it installs it.
 *
 * It fails when the version has no entry. A release without notes is a release
 * nobody can read about, and the build is the last place to stop it.
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const source = readFileSync("build/release-notes.md", "utf8").replace(/\r\n/g, "\n");

const start = source.search(new RegExp(`^## ${version.replaceAll(".", "[.]")}$`, "m"));
if (start === -1) {
	console.error(`build/release-notes.md has no entry for version ${version}. Write it first (.claude/rules/release-notes.md).`);
	process.exit(1);
}

const rest = source.slice(start + 3);
const next = rest.search(/^## /m);
const entry = source.slice(start, next === -1 ? undefined : start + 3 + next).trimEnd();

writeFileSync("build/release-notes-latest.md", `${entry}\n`, "utf8");
console.log(`Release notes for ${version} written to build/release-notes-latest.md.`);
