import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

/** Drives the real extension.ts through a fake host with a real local HTTP server. */
let server: Server;
let ollama: Server;
let base = "";
let home = "";
const hits: string[] = [];
const tools: Record<string, any> = {};
const handlers: Record<string, (event: any) => any> = {};

before(async () => {
	home = await mkdtemp(join(tmpdir(), "pi-ext-"));
	server = createServer((req, res) => {
		hits.push(req.url ?? "");
		if (req.url?.startsWith("/pay")) {
			res.writeHead(402);
			res.end("pay up");
			return;
		}
		res.writeHead(200, { "content-type": "text/html" });
		res.end(`<html><title>T</title><body><p>hello ${req.url} and the connector times out after 30 seconds.</p></body></html>`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	base = `http://127.0.0.1:${port}`;
	ollama = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			const claims = [
				{ claim: "Timeout is 30 seconds.", quote: "the connector times out after 30 seconds.", numbers: ["30"] },
				{ claim: "Invented.", quote: "the connector never times out at all ever.", numbers: [] },
			];
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ message: { content: JSON.stringify({ claims }) } }));
		});
	});
	await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
	const ollamaPort = (ollama.address() as { port: number }).port;
	await mkdir(join(home, ".pi/agent/pi-deep-research"), { recursive: true });
	await writeFile(
		join(home, ".pi/agent/pi-deep-research/config.json"),
		JSON.stringify({ providers: ["jina"], ollama: { enabled: false, host: "127.0.0.1", port: String(ollamaPort) }, llm: { model: "test-model" }, cache: { enabled: false }, safety: { allow_private_hosts: true, allowed_ports: [port] }, archive: { root: join(home, "arch") } }),
	);
	process.env.HOME = home;
	delete process.env.OLLAMA_HOST;
	delete process.env.OLLAMA_PORT;
	delete process.env.LLM_MODEL;
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
	ollama.close();
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

	it("treats HTTP 402 as terminal and never fetches the URL again", async () => {
		handlers.input({ type: "input", text: `read ${base}/pay`, source: "interactive" });
		assert.match(await run("web_extract", { url: `${base}/pay` }), /FAILED/);
		const before = hits.filter((h) => h === "/pay").length;
		assert.equal(before, 1);
		assert.match(await run("web_extract", { url: `${base}/pay` }), /payment_required/);
		assert.equal(hits.filter((h) => h === "/pay").length, before);
	});

	it("source_claims returns only claims whose quote is on the page", async () => {
		handlers.input({ type: "input", text: `read ${base}/claims`, source: "interactive" });
		await run("web_extract", { url: `${base}/claims` });
		const text = await run("source_claims", { url: `${base}/claims` });
		assert.match(text, /Timeout is 30 seconds/);
		assert.doesNotMatch(text, /Invented/);
		assert.match(text, /1 item\(s\) dropped/);
	});
});
