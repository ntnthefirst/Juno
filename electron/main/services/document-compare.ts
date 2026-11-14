/**
 * What an incoming file says differently from a version Juno keeps, word by
 * word (decision 39 matches by words; this shows which). The window names the
 * kept file by its version id and the incoming one as it names it for an
 * import, a drop's bytes or a mail attachment's id, and the service reads
 * both. An agent names the incoming file by path, through its own function.
 */
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import type { CompareSource, CompareTextInput, TextComparison } from "../../shared/types";
import { getDb, type Db } from "../db";
import * as versions from "./document-versions";
import { readableText } from "./file-text";
import { resolvePath, resolveSource } from "./document-import";
import { diffWords } from "./text-diff";

type Read = { bytes: Uint8Array; fileName: string };

function readVersion(versionId: string, db: Db): Read {
	const path = versions.pathOf(versionId, db);
	return { bytes: new Uint8Array(readFileSync(path)), fileName: basename(path) };
}

function readSource(source: CompareSource, db: Db): Read {
	if (source.kind === "version") return readVersion(source.versionId, db);
	const resolved = resolveSource(source, db);
	return { bytes: new Uint8Array(resolved.bytes), fileName: resolved.fileName };
}

async function textOf(file: Read): Promise<string | null> {
	return (await readableText(file.bytes, file.fileName)).text;
}

async function compareRead(before: Read, after: Read): Promise<TextComparison> {
	const [left, right] = await Promise.all([textOf(before), textOf(after)]);
	if (left === null || right === null) {
		return { status: "unreadable", side: left === null && right === null ? "both" : left === null ? "before" : "after" };
	}
	return { status: "compared", ...diffWords(left, right) };
}

export async function compareText(input: CompareTextInput, db: Db = getDb()): Promise<TextComparison> {
	return compareRead(readVersion(input.before.versionId, db), readSource(input.after, db));
}

/** For the agent: a version against another version, or against a file on this machine. */
export async function compareForAgent(
	input: { versionId: string; otherVersionId?: string; sourcePath?: string },
	db: Db = getDb(),
): Promise<TextComparison> {
	if (input.otherVersionId) return compareText({ before: { kind: "version", versionId: input.versionId }, after: { kind: "version", versionId: input.otherVersionId } }, db);
	if (!input.sourcePath) throw new Error("Name the file to compare with: other_version_id, or source_path for a file on this machine.");
	const resolved = resolvePath(input.sourcePath);
	return compareRead(readVersion(input.versionId, db), { bytes: new Uint8Array(resolved.bytes), fileName: resolved.fileName });
}
