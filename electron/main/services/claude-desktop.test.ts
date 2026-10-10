import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkUrl, forward } from "../../bridge/claude-desktop";
import { startHttpServer, stopHttpServer, type HttpServerDeps } from "../mcp/http-server";
import * as connections from "./agent-connections";
import { buildExtension, manifestOf, zipStored } from "./claude-desktop";

/** Reads a stored zip back by walking its local headers, which is all zipStored writes. */
function entries(zip: Buffer): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	let at = 0;
	while (zip.readUInt32LE(at) === 0x04034b50) {
		const size = zip.readUInt32LE(at + 18);
		const nameLength = zip.readUInt16LE(at + 26);
		const name = zip.subarray(at + 30, at + 30 + nameLength).toString("utf8");
		const data = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
		expect(zip.readUInt32LE(at + 14)).toBe(crc32(data));
		out.set(name, Buffer.from(data));
		at += 30 + nameLength + size;
	}
	expect(zip.readUInt32LE(at)).toBe(0x02014b50);
	return out;
}

describe("the extension bundle", () => {
	it("stores every file whole, with a central directory that counts them", () => {
		const zip = zipStored([
			{ name: "a.txt", data: Buffer.from("first") },
			{ name: "dir/b.txt", data: Buffer.from("second") },
		]);
		const files = entries(zip);
		expect(files.get("a.txt")?.toString()).toBe("first");
		expect(files.get("dir/b.txt")?.toString()).toBe("second");
		const end = zip.subarray(zip.length - 22);
		expect(end.readUInt32LE(0)).toBe(0x06054b50);
		expect(end.readUInt16LE(10)).toBe(2);
	});

	it("carries the manifest and the bridge, and never a token", () => {
		const zip = buildExtension({
			url: "http://127.0.0.1:5866/mcp",
			version: "1.4.0",
			bridgeSource: "console.error('bridge');\n//# sourceMappingURL=claude-desktop.js.map\n",
			icon: null,
		});
		const files = entries(zip);
		expect([...files.keys()]).toEqual(["manifest.json", "server/index.js"]);
		expect(files.get("server/index.js")?.toString()).toBe("console.error('bridge');\n");

		const manifest = JSON.parse(files.get("manifest.json")!.toString()) as ReturnType<typeof manifestOf> & {
			user_config: Record<string, { default?: string; sensitive?: boolean }>;
			server: { entry_point: string };
		};
		expect(manifest.server.entry_point).toBe("server/index.js");
		expect(manifest.user_config.url.default).toBe("http://127.0.0.1:5866/mcp");
		expect(manifest.user_config.token.sensitive).toBe(true);
		expect(manifest.user_config.token.default).toBeUndefined();
	});

	it("gives Claude a version it accepts, even from a development build", () => {
		expect(manifestOf({ url: "x", version: "1.4.0", icon: null }).version).toBe("1.4.0");
		expect(manifestOf({ url: "x", version: "dev", icon: null }).version).toBe("0.0.0");
	});
});

describe("the bridge's address check", () => {
	it("takes this machine and nothing else, so the token stays here", () => {
		expect(checkUrl("http://127.0.0.1:5866/mcp")).toBe("http://127.0.0.1:5866/mcp");
		expect(checkUrl(" http://localhost:5866/mcp ")).toBe("http://localhost:5866/mcp");
		expect(() => checkUrl("https://juno.example.com/mcp")).toThrow(/this machine/);
		expect(() => checkUrl("http://127.0.0.1.example.com/mcp")).toThrow(/this machine/);
		expect(() => checkUrl("not a url")).toThrow(/not an address/);
	});
});

describe("the bridge against the agent server", () => {
	let dir: string;
	let url: string;
	let locked = false;

	const deps: HttpServerDeps = {
		version: "9.9.9",
		isLocked: () => locked,
		listTools: () => [
			{
				name: "demo.echo",
				title: "Echo",
				description: "Gives back what it was given.",
				inputSchema: { type: "object", properties: { text: { type: "string" } } },
				readOnly: true,
				requiresConfirmation: false,
			},
		],
		callTool: async (_name, args) => ({ echoed: args.text ?? null }),
	};

	beforeAll(async () => {
		const status = await startHttpServer(0, deps);
		url = `http://127.0.0.1:${status.port}/mcp`;
	});

	afterAll(async () => {
		await stopHttpServer();
	});

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "juno-bridge-"));
		connections.configureAgentConnections(dir);
		locked = false;
	});

	afterEach(() => {
		connections.configureAgentConnections(null);
		rmSync(dir, { recursive: true, force: true });
	});

	type Reply = { id?: number; result?: Record<string, unknown>; error?: { message: string } };

	it("initializes, lists the tools and calls one, the way Claude Desktop does", async () => {
		const { token } = connections.createToken("Claude Desktop");
		const state = { protocolVersion: null as string | null };
		const options = { url, token };

		const [init] = (await forward(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } },
			} as never,
			options,
			state,
		)) as Reply[];
		expect(init.result?.serverInfo).toMatchObject({ version: "9.9.9" });
		expect(state.protocolVersion).toBe("2025-06-18");

		expect(await forward({ jsonrpc: "2.0", method: "notifications/initialized" }, options, state)).toEqual([]);

		const [list] = (await forward({ jsonrpc: "2.0", id: 2, method: "tools/list" }, options, state)) as Reply[];
		expect(JSON.stringify(list.result)).toContain("demo.echo");

		const [called] = (await forward(
			{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo.echo", arguments: { text: "hallo" } } } as never,
			options,
			state,
		)) as Reply[];
		expect(called.id).toBe(3);
		expect(JSON.stringify(called.result)).toContain("hallo");
	});

	it("says what to do when the token is not accepted", async () => {
		const [reply] = (await forward(
			{ jsonrpc: "2.0", id: 7, method: "tools/list" },
			{ url, token: "x".repeat(43) },
			{ protocolVersion: null },
		)) as Reply[];
		expect(reply.id).toBe(7);
		expect(reply.error?.message).toMatch(/did not accept the access token/);
	});

	it("says Juno is not running when nothing answers", async () => {
		const [reply] = (await forward(
			{ jsonrpc: "2.0", id: 8, method: "tools/list" },
			{ url: "http://127.0.0.1:1/mcp", token: "x".repeat(43) },
			{ protocolVersion: null },
		)) as Reply[];
		expect(reply.error?.message).toMatch(/not running/);
	});
});
