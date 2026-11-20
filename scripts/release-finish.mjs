// Checks the draft release a tag produced, then publishes it or removes it.
//
// Run by the finish job in .github/workflows/release.yml, with GH_TOKEN, TAG,
// BUILD (the build job's result) and GITHUB_REPOSITORY set. A draft that has
// every file the updater and the download page need is published, as the
// latest release or, for a tag with a suffix (v1.4.0-beta.1), as a
// pre-release. Anything less and the draft and its tag are deleted, so nobody
// can install half a release and the next merge cuts the version again.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tag = process.env.TAG;
const repo = process.env.GITHUB_REPOSITORY;
const build = process.env.BUILD;
if (!tag || !repo) throw new Error("TAG and GITHUB_REPOSITORY must be set.");

const version = tag.replace(/^v/, "");
const prerelease = version.includes("-");

function gh(...args) {
	return execFileSync("gh", args, { encoding: "utf8" });
}

/**
 * The update feed's name. electron-builder names it after the pre-release
 * channel, so 1.4.0-beta.1 writes beta.yml and beta-mac.yml, and a plain
 * version writes latest.yml.
 */
function channelOf(v) {
	return v.includes("-") ? v.split("-")[1].split(".")[0] : "latest";
}

const feeds = [`${channelOf(version)}.yml`, `${channelOf(version)}-mac.yml`];

/** Every file a complete release carries, named the way electron-builder.yml names them. */
function expectedAssets(v) {
	const files = [`Juno-Setup-${v}-x64.exe`, `Juno-Setup-${v}-x64.exe.blockmap`, ...feeds];
	for (const arch of ["x64", "arm64"]) {
		for (const ext of ["dmg", "zip"]) files.push(`Juno-${v}-${arch}.${ext}`, `Juno-${v}-${arch}.${ext}.blockmap`);
	}
	return files;
}

function problems() {
	const found = [];
	if (build !== "success") found.push(`the build job ended as ${build}`);

	let release;
	try {
		release = JSON.parse(gh("release", "view", tag, "--repo", repo, "--json", "isDraft,body,assets"));
	} catch {
		return [...found, "there is no release for this tag"];
	}
	if (!release.isDraft) found.push("the release is not a draft any more");
	if (!release.body || !release.body.trim()) found.push("the release has no notes");

	const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
	for (const name of expectedAssets(version)) {
		const asset = assets.get(name);
		if (!asset) found.push(`${name} is missing`);
		else if (!(asset.size > 0)) found.push(`${name} is empty`);
		else if (asset.state && asset.state !== "uploaded") found.push(`${name} did not finish uploading`);
	}

	// The update feeds have to name this version, or every installed copy is
	// pointed at the wrong files.
	const dir = mkdtempSync(join(tmpdir(), "juno-release-"));
	for (const feed of feeds) {
		if (!assets.has(feed)) continue;
		try {
			gh("release", "download", tag, "--repo", repo, "--pattern", feed, "--dir", dir, "--clobber");
			const text = readFileSync(join(dir, feed), "utf8");
			if (!new RegExp(`^version: ${version.replace(/\./g, "\\.")}\\s*$`, "m").test(text)) {
				found.push(`${feed} does not name version ${version}`);
			}
		} catch {
			found.push(`${feed} could not be read back`);
		}
	}
	return found;
}

const wrong = problems();

if (wrong.length > 0) {
	console.error(`${tag} is not complete, so the draft and the tag are deleted:`);
	for (const line of wrong) console.error(`- ${line}`);
	try {
		gh("release", "delete", tag, "--repo", repo, "--cleanup-tag", "--yes");
	} catch {
		// No release to delete; the tag may still be there on its own.
		try {
			gh("api", "-X", "DELETE", `repos/${repo}/git/refs/tags/${tag}`);
		} catch {
			// Already gone.
		}
	}
	process.exit(1);
}

gh(
	"release",
	"edit",
	tag,
	"--repo",
	repo,
	"--draft=false",
	...(prerelease ? ["--prerelease", "--latest=false"] : ["--prerelease=false", "--latest"]),
);
console.log(`${tag} is complete and published as ${prerelease ? "a pre-release" : "the latest release"}.`);
