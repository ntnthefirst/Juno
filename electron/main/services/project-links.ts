/**
 * The places a project lives that are not files: a repository, a design file, a
 * staging URL, a folder on this machine.
 *
 * A link's `target` is one of two things and the service decides which, not the
 * component that draws it. An https URL opens in the browser; an absolute path
 * opens in the file manager. Anything else is refused here rather than handed
 * to `shell.openExternal`, which would happily follow a `javascript:` or a
 * `file:` target that arrived in a record (.claude/rules/security.md section 3).
 */
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { isAbsolute } from "node:path";
import type { ProjectLink, ProjectLinkInput, ProjectLinkKind, ProjectLinkPatch } from "../../shared/types";
import { getDb, type Db } from "../db";
import { now } from "../db/columns";
import { projectLinks } from "../db/schema";
import { requireProject } from "./projects";

const KINDS: ProjectLinkKind[] = [
	"github",
	"figma",
	"website",
	"design",
	"docs",
	"folder",
	"other",
];

export type LinkTarget = { type: "url"; url: string } | { type: "path"; path: string };

/**
 * What a target is, or why it is not allowed to be anything.
 *
 * https only, and no other protocol. http is left out deliberately: every host
 * worth linking to speaks https, and allowing the plain one would put a
 * downgrade one typo away for no gain a back office needs.
 */
export function classifyTarget(raw: string): LinkTarget {
	const value = raw.trim();
	if (!value) throw new Error("A link needs a target: an https address, or a folder on this machine.");

	if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
		let parsed: URL;
		try {
			parsed = new URL(value);
		} catch {
			throw new Error(`Juno cannot make sense of "${value}". Use an https address or a full folder path.`);
		}
		if (parsed.protocol !== "https:") {
			throw new Error(
				`Links open in your browser, so they have to be https. "${parsed.protocol}" is not.`,
			);
		}
		return { type: "url", url: parsed.toString() };
	}

	if (!isAbsolute(value)) {
		throw new Error(
			`"${value}" is neither an https address nor a full path. A folder needs its whole path.`,
		);
	}
	return { type: "path", path: value };
}

/** github.com and figma.com say what they are, so the form does not have to ask. */
export function guessKind(target: string): ProjectLinkKind {
	const value = target.trim().toLowerCase();
	if (/^[a-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\")) return "folder";
	if (value.includes("github.com") || value.includes("gitlab.com") || value.includes("bitbucket.org")) {
		return "github";
	}
	if (value.includes("figma.com")) return "figma";
	if (value.includes("dribbble.com") || value.includes("behance.net")) return "design";
	if (value.includes("notion.so") || value.includes("/docs") || value.includes("readme")) return "docs";
	if (value.startsWith("https://")) return "website";
	return "other";
}

function checkKind(kind: unknown): ProjectLinkKind {
	if (typeof kind !== "string" || !KINDS.includes(kind as ProjectLinkKind)) {
		throw new Error(`Unknown link kind "${String(kind)}". Use one of: ${KINDS.join(", ")}.`);
	}
	return kind as ProjectLinkKind;
}

function requireLabel(label: unknown): string {
	const value = typeof label === "string" ? label.trim() : "";
	if (!value) throw new Error("A link needs a name, so the list says what it is.");
	return value;
}

function nextSortOrder(projectId: string, db: Db): number {
	const row = db
		.select({ highest: max(projectLinks.sortOrder) })
		.from(projectLinks)
		.where(and(eq(projectLinks.projectId, projectId), isNull(projectLinks.deletedAt)))
		.get();
	return (row?.highest ?? -1) + 1;
}

export async function listForProject(projectId: string, db: Db = getDb()): Promise<ProjectLink[]> {
	return db
		.select()
		.from(projectLinks)
		.where(and(eq(projectLinks.projectId, projectId), isNull(projectLinks.deletedAt)))
		.orderBy(asc(projectLinks.sortOrder), asc(projectLinks.id))
		.all() as ProjectLink[];
}

export async function get(id: string, db: Db = getDb()): Promise<ProjectLink | null> {
	const row = db
		.select()
		.from(projectLinks)
		.where(and(eq(projectLinks.id, id), isNull(projectLinks.deletedAt)))
		.get();
	return (row as ProjectLink | undefined) ?? null;
}

export async function create(input: ProjectLinkInput, db: Db = getDb()): Promise<ProjectLink> {
	requireProject(input.projectId, db);
	const label = requireLabel(input.label);
	const target = classifyTarget(input.target);
	const kind = input.kind ? checkKind(input.kind) : guessKind(input.target);

	return db
		.insert(projectLinks)
		.values({
			projectId: input.projectId,
			label,
			target: target.type === "url" ? target.url : target.path,
			kind,
			notes: input.notes ?? null,
			sortOrder: input.sortOrder ?? nextSortOrder(input.projectId, db),
		})
		.returning()
		.get() as ProjectLink;
}

export async function update(
	id: string,
	patch: ProjectLinkPatch,
	db: Db = getDb(),
): Promise<ProjectLink> {
	const values: Partial<typeof projectLinks.$inferInsert> = { ...patch, updatedAt: now() };
	if (patch.label !== undefined) values.label = requireLabel(patch.label);
	if (patch.kind !== undefined) values.kind = checkKind(patch.kind);
	if (patch.target !== undefined) {
		const target = classifyTarget(patch.target);
		values.target = target.type === "url" ? target.url : target.path;
	}

	const row = db
		.update(projectLinks)
		.set(values)
		.where(and(eq(projectLinks.id, id), isNull(projectLinks.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No link with id "${id}" to update. It may have been deleted.`);
	return row as ProjectLink;
}

export async function remove(id: string, db: Db = getDb()): Promise<ProjectLink> {
	const stamp = now();
	const row = db
		.update(projectLinks)
		.set({ deletedAt: stamp, updatedAt: stamp })
		.where(and(eq(projectLinks.id, id), isNull(projectLinks.deletedAt)))
		.returning()
		.get();
	if (!row) throw new Error(`No link with id "${id}" to delete. It may already be deleted.`);
	return row as ProjectLink;
}

/** The ids in the order the user dragged them into. Anything missing is left alone. */
export async function reorder(
	projectId: string,
	orderedIds: string[],
	db: Db = getDb(),
): Promise<ProjectLink[]> {
	const stamp = now();
	db.transaction((tx) => {
		orderedIds.forEach((id, index) => {
			tx.update(projectLinks)
				.set({ sortOrder: index, updatedAt: stamp })
				.where(and(eq(projectLinks.id, id), eq(projectLinks.projectId, projectId)))
				.run();
		});
	});
	return listForProject(projectId, db);
}
