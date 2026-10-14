import { describe, expect, it } from "vitest";
import { isPrivateAddress, loadPicture, sniffPicture } from "./mail-pictures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const publicHost = async () => [{ address: "93.184.216.34" }];

function answer(body: Uint8Array, init: ResponseInit = {}): typeof fetch {
	return async () => new Response(body, { status: 200, ...init });
}

describe("isPrivateAddress", () => {
	it("flags addresses a public picture is never on", () => {
		for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.5", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
			expect(isPrivateAddress(address)).toBe(true);
		}
		expect(isPrivateAddress("93.184.216.34")).toBe(false);
	});
});

describe("sniffPicture", () => {
	it("knows the four raster formats and nothing else", () => {
		expect(sniffPicture(PNG)).toBe("image/png");
		expect(sniffPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
		expect(sniffPicture(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
	});
});

describe("loadPicture", () => {
	it("returns the bytes inline for a public https picture", async () => {
		const result = await loadPicture("https://cdn.example.com/logo.png", answer(PNG), publicHost);
		expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("refuses http, logins in the address and private hosts", async () => {
		await expect(loadPicture("http://cdn.example.com/a.png", answer(PNG), publicHost)).rejects.toThrow(/https/);
		await expect(loadPicture("https://me:pw@cdn.example.com/a.png", answer(PNG), publicHost)).rejects.toThrow(/login/);
		await expect(loadPicture("https://intranet.example.com/a.png", answer(PNG), async () => [{ address: "10.0.0.4" }])).rejects.toThrow(/private/);
	});

	it("refuses a redirect to a private host", async () => {
		let calls = 0;
		const fetcher: typeof fetch = async () => {
			calls++;
			return new Response(null, { status: 302, headers: { location: "https://internal.example.com/a.png" } });
		};
		const resolve = async (host: string) => [{ address: host === "internal.example.com" ? "127.0.0.1" : "93.184.216.34" }];
		await expect(loadPicture("https://cdn.example.com/a.png", fetcher, resolve)).rejects.toThrow(/private/);
		expect(calls).toBe(1);
	});

	it("refuses what is not a picture, whatever the server says it is", async () => {
		const svg = new TextEncoder().encode("<svg/>");
		await expect(loadPicture("https://cdn.example.com/a.png", answer(svg, { headers: { "content-type": "image/png" } }), publicHost)).rejects.toThrow(/PNG, JPEG/);
	});
});
