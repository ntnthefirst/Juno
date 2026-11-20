// Removes the files from every published release except the five newest.
//
// Run by the prune job in .github/workflows/release.yml once a release has
// gone out, or by hand with GH_TOKEN and GITHUB_REPOSITORY set. A release keeps
// its page, its notes and its tag, so the history of what changed stays
// readable. Only the uploaded installers, blockmaps and update feeds go, and
// GitHub's own source archives cannot be removed and stay too. Drafts are left
// alone: a draft is a release still being made.
//
// DRY_RUN=1 lists what would go and removes nothing.

import { execFileSync } from "node:child_process";

const KEEP = 5;
const repo = process.env.GITHUB_REPOSITORY;
const dryRun = process.env.DRY_RUN === "1";
if (!repo) throw new Error("GITHUB_REPOSITORY must be set.");

function gh(...args) {
	return execFileSync("gh", args, { encoding: "utf8" });
}

const releases = JSON.parse(gh("release", "list", "--repo", repo, "--limit", "1000", "--json", "tagName,isDraft,publishedAt"))
	.filter((release) => !release.isDraft)
	.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

let removed = 0;
for (const release of releases.slice(KEEP)) {
	const { assets } = JSON.parse(gh("release", "view", release.tagName, "--repo", repo, "--json", "assets"));
	for (const asset of assets) {
		if (dryRun) console.log(`would remove ${release.tagName} ${asset.name}`);
		else gh("release", "delete-asset", release.tagName, asset.name, "--repo", repo, "--yes");
		removed += 1;
	}
}
console.log(`${dryRun ? "Would remove" : "Removed"} ${removed} files from ${Math.max(0, releases.length - KEEP)} older releases.`);
