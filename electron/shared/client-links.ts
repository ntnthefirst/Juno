/**
 * The kinds of link a client can have. The kind picks an icon and a default
 * label and nothing else. Shared so the service can guess one from an address
 * and the renderer can offer the same list.
 */
export const CLIENT_LINK_KINDS = [
	"website",
	"linkedin",
	"instagram",
	"facebook",
	"x",
	"youtube",
	"github",
	"other",
] as const;

export type ClientLinkKind = (typeof CLIENT_LINK_KINDS)[number];

export const CLIENT_LINK_KIND_LABELS: Record<ClientLinkKind, string> = {
	website: "Website",
	linkedin: "LinkedIn",
	instagram: "Instagram",
	facebook: "Facebook",
	x: "X",
	youtube: "YouTube",
	github: "GitHub",
	other: "Other",
};

const HOSTS: [ClientLinkKind, string[]][] = [
	["linkedin", ["linkedin.com", "lnkd.in"]],
	["instagram", ["instagram.com"]],
	["facebook", ["facebook.com", "fb.com", "fb.me"]],
	["x", ["x.com", "twitter.com"]],
	["youtube", ["youtube.com", "youtu.be"]],
	["github", ["github.com"]],
];

export function isClientLinkKind(value: unknown): value is ClientLinkKind {
	return typeof value === "string" && (CLIENT_LINK_KINDS as readonly string[]).includes(value);
}

/** The kind an address most likely is, from its host. Anything unknown is a website. */
export function guessClientLinkKind(url: string): ClientLinkKind {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "website";
	}
	for (const [kind, hosts] of HOSTS) {
		if (hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) return kind;
	}
	return "website";
}
