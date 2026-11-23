import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

/** Drives the real extension.ts through a fake host with a real local HTTP server. */
let server: Server;
let base = "";
let home = "";
const tools: Record<string, any> = {};
const handlers: Record<string, (event: any) => any> = {};

before(async () => {
	home = await mkdtemp(join(tmpdir(), "pi-ext-"));
	server = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end(`<html><title>T</title><body><p>hello ${req.url}</p></body></html>`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	base = `http://127.0.0.1:${port}`;
	await mkdir(join(home, ".pi/agent/pi-deep-research"), { recursive: true });
	await writeFile(
		join(home, ".pi/agent/pi-deep-research/config.json"),
		JSON.stringify({ providers: ["jina"], cache: { enabled: false }, safety: { allow_private_hosts: true, allowed_ports: [port] }, archive: { root: join(home, "arch") } }),
	);
	process.env.HOME = home;
	process.env.JINA_API_KEY = "off";
	const { default: extension } = await import("../extension.ts");
	await extension({
		registerTool: (tool: any) => (tools[tool.name] = tool),
		registerCommand() {},
		registerMessageRenderer() {},
		on: (event: string, handler: (event: any) => any) => (handlers[event] = handler),
	} as any);
});
after(async () => {
	server.close();
	await rm(home, { recursive: true, force: true });
});

const run = async (name: string, params: Record<string, unknown>) => (await tools[name].execute("id", params)).content[0].text as string;

describe("extension URL provenance", () => {
	it("refuses a URL nobody typed or returned", async () => {
		const text = await run("web_extract", { url: `${base}/secret?token=abc` });
		assert.match(text, /refused/);
		assert.doesNotMatch(text, /hello/);
	});

	it("fetches a URL the user typed, and not its query-string variant", async () => {
		handlers.input({ type: "input", text: `read ${base}/doc please`, source: "interactive" });
		assert.match(await run("web_extract", { url: `${base}/doc` }), /hello \/doc/);
		assert.match(await run("web_extract", { url: `${base}/doc?q=secret` }), /refused/);
	});
});
