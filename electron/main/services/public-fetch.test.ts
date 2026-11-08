import { describe, expect, it } from "vitest";
import { fetchPublic, type PublicFetchOptions } from "./public-fetch";

const publicHost = async () => [{ address: "93.184.216.34" }];

function options(extra: Partial<PublicFetchOptions> = {}): PublicFetchOptions {
	return {
		label: "example.com",
		what: "calendar",
		accept: "text/calendar",
		sizeLimit: 1024,
		timeoutMs: 1000,
		resolve: publicHost,
		...extra,
	};
}

/** A body that never says how long it is, sent in pieces. */
function streamed(chunks: number, size: number): ReadableStream<Uint8Array> {
	let sent = 0;
	return new ReadableStream({
		pull(controller) {
			if (sent >= chunks) {
				controller.close();
				return;
			}
			sent++;
			controller.enqueue(new Uint8Array(size));
		},
	});
}

describe("fetchPublic", () => {
	it("refuses a body over the cap even when the server does not say its length", async () => {
		let pulled = 0;
		const fetcher: typeof fetch = async () =>
			new Response(
				new ReadableStream({
					pull(controller) {
						pulled++;
						controller.enqueue(new Uint8Array(512));
					},
				}),
			);
		await expect(fetchPublic("https://example.com/a.ics", options({ fetcher }))).rejects.toThrow(/larger than/);
		// It stopped reading soon after the cap, not at the end of an endless body.
		expect(pulled).toBeLessThan(10);
	});

	it("refuses a declared length over the cap without reading it", async () => {
		const fetcher: typeof fetch = async () =>
			new Response(streamed(1, 10), { headers: { "content-length": String(10 * 1024 * 1024) } });
		await expect(fetchPublic("https://example.com/a.ics", options({ fetcher }))).rejects.toThrow(/larger than/);
	});

	it("reads a body under the cap in pieces", async () => {
		const fetcher: typeof fetch = async () => new Response(streamed(3, 100));
		const result = await fetchPublic("https://example.com/a.ics", options({ fetcher }));
		expect(result.notModified).toBe(false);
		if (!result.notModified) expect(result.bytes.byteLength).toBe(300);
	});

	it("hands back a 304 as not modified and passes the validators on", async () => {
		let sent: Headers | null = null;
		const fetcher: typeof fetch = async (_url, init) => {
			sent = new Headers(init?.headers);
			return new Response(null, { status: 304 });
		};
		const result = await fetchPublic(
			"https://example.com/a.ics",
			options({ fetcher, headers: { "if-none-match": '"v1"' } }),
		);
		expect(result.notModified).toBe(true);
		expect(sent!.get("if-none-match")).toBe('"v1"');
	});

	it("names the address by its label, never by the whole address", async () => {
		const fetcher: typeof fetch = async () => new Response(null, { status: 404 });
		const failure = fetchPublic("https://example.com/private/secret-token/basic.ics", options({ fetcher }));
		await expect(failure).rejects.toThrow(/example\.com/);
		await expect(failure).rejects.not.toThrow(/secret-token/);
	});
});
