import { beforeEach, describe, expect, it } from "vitest";
import { forgetLoadedFonts, loadGoogleFont } from "./mail-fonts";

const STYLESHEET = `/* cyrillic */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/cyrillic.woff2) format('woff2');
}
/* latin-ext */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/latin-ext.woff2) format('woff2');
}
/* latin */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/latin.woff2) format('woff2');
}`;

type Call = { url: string };

function fakeFetch(answers: Record<string, () => Response>, calls: Call[]): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		calls.push({ url });
		const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1];
		if (!answer) throw new Error(`unexpected ${url}`);
		return answer();
	}) as typeof fetch;
}

describe("loadGoogleFont", () => {
	beforeEach(() => forgetLoadedFonts());

	it("asks by name and inlines only the Latin files", async () => {
		const calls: Call[] = [];
		const load = await loadGoogleFont(
			{ family: "Lora", weights: [400], italic: false },
			fakeFetch(
				{
					"https://fonts.googleapis.com/": () => new Response(STYLESHEET, { status: 200 }),
					"https://fonts.gstatic.com/": () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
				},
				calls,
			),
		);
		expect(load.href).toBe("https://fonts.googleapis.com/css2?family=Lora:wght@400&display=swap");
		// A Dutch letter needs two of Google's seven scripts, not all of them.
		expect(calls.map((call) => call.url)).not.toContain("https://fonts.gstatic.com/s/lora/cyrillic.woff2");
		expect(calls).toHaveLength(3);
		expect(load.css).toContain("url(data:font/woff2;base64,AQID)");
		expect(load.css).not.toContain("gstatic");
	});

	it("refuses a name that is not a family before asking anybody", async () => {
		const calls: Call[] = [];
		await expect(
			loadGoogleFont({ family: "x');}body{", weights: [400], italic: false }, fakeFetch({}, calls)),
		).rejects.toThrow("not a font family name");
		expect(calls).toHaveLength(0);
	});

	it("never fetches a font file from anywhere but Google's own host", async () => {
		const calls: Call[] = [];
		const elsewhere = STYLESHEET.replace(/fonts\.gstatic\.com/g, "evil.example");
		await expect(
			loadGoogleFont(
				{ family: "Lora", weights: [400], italic: false },
				fakeFetch({ "https://fonts.googleapis.com/": () => new Response(elsewhere, { status: 200 }) }, calls),
			),
		).rejects.toThrow("Could not reach Google Fonts");
		expect(calls.every((call) => !call.url.includes("evil.example"))).toBe(true);
	});

	it("says which font when Google has no such family or weight", async () => {
		await expect(
			loadGoogleFont(
				{ family: "Lora", weights: [100], italic: false },
				fakeFetch({ "https://fonts.googleapis.com/": () => new Response("", { status: 400 }) }, []),
			),
		).rejects.toThrow("Google Fonts has no Lora in every weight you picked");
	});

	it("forgets a failed load, so trying again after reconnecting works", async () => {
		let online = false;
		const calls: Call[] = [];
		const fetchImpl = fakeFetch(
			{
				"https://fonts.googleapis.com/": () => {
					if (!online) throw new TypeError("offline");
					return new Response(STYLESHEET, { status: 200 });
				},
				"https://fonts.gstatic.com/": () => new Response(new Uint8Array([1]), { status: 200 }),
			},
			calls,
		);
		await expect(loadGoogleFont({ family: "Lora", weights: [400], italic: false }, fetchImpl)).rejects.toThrow();
		online = true;
		const load = await loadGoogleFont({ family: "Lora", weights: [400], italic: false }, fetchImpl);
		expect(load.css).toContain("data:font/woff2");
	});
});
