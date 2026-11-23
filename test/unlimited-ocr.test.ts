import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { RawCapture } from "../src/raw-store.ts";
import { cleanOcrOutput, createUnlimitedOcrProvider } from "../src/native/unlimited-ocr.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

let server: Server;
let base = "";
let dir = "";
const bodies: Array<Record<string, any>> = [];
let reply = "<PAGE># Title\nPage one<PAGE>Page two";
let status = 200;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), "uocr-test-"));
	server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			bodies.push({ path: req.url, auth: req.headers.authorization, ...JSON.parse(raw) });
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

async function capture(name: string, contentType: string, bytes = "x"): Promise<RawCapture> {
	const path = join(dir, name);
	await writeFile(path, bytes);
	const suffix = name.slice(name.lastIndexOf("."));
	return { url: `https://e.example/${name}`, path, suffix, digest: "d", bytes: bytes.length, contentType, capturedAt: "t" };
}

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS.uocr, baseUrl: base, ...over });
const pages = (n: number) => async () => Array.from({ length: n }, (_, i) => Buffer.from(`p${i}`));

describe("unlimited-ocr", () => {
	it("is unconfigured without a base URL", () => {
		const provider = createUnlimitedOcrProvider(DEFAULT_SETTINGS.uocr, { capture: async () => capture("a.pdf", "application/pdf") });
		assert.equal(provider.isConfigured(), false);
	});

	it("sends one page-ordered multi-page request and strips page markers", async () => {
		bodies.length = 0;
		const provider = createUnlimitedOcrProvider(settings({ logitProcessor: "LP", apiKey: "k" }), {
			capture: async () => capture("a.pdf", "application/pdf"),
			renderPages: pages(2),
		});
		const result = await provider.extract!("https://e.example/a.pdf");
		assert.equal(bodies.length, 1);
		const body = bodies[0];
		assert.equal(body.path, "/v1/chat/completions");
		assert.equal(body.auth, "Bearer k");
		const parts = body.messages[0].content;
		assert.equal(parts.filter((p: any) => p.type === "image_url").length, 2);
		assert.equal(parts.at(-1).text, "<PAGE><image><PAGE><image>Multi page parsing.");
		assert.equal(body.max_tokens, 16000);
		assert.equal(body.custom_logit_processor, "LP");
		assert.equal(body.custom_params.window_size, 1024);
		assert.equal(result.content, "# Title\nPage one\n\n---\n\nPage two");
		assert.equal(result.title, "Title");
		assert.equal(result.provider, "unlimited-ocr");
	});

	it("the llama-cpp backend sends images only, with no SGLang-specific fields", async () => {
		bodies.length = 0;
		const provider = createUnlimitedOcrProvider(settings({ backend: "llama-cpp", logitProcessor: "LP" }), {
			capture: async () => capture("a.pdf", "application/pdf"),
			renderPages: pages(2),
		});
		await provider.extract!("https://e.example/a.pdf");
		const body = bodies[0];
		const parts = body.messages[0].content;
		assert.equal(parts.length, 2);
		assert.ok(parts.every((p: any) => p.type === "image_url"), "no text part: the chat template adds the instruction");
		for (const key of ["skip_special_tokens", "images_config", "custom_logit_processor", "custom_params"]) assert.ok(!(key in body), key);
		assert.equal(body.temperature, 0);
	});

	it("omits logit-processor fields when none is configured", async () => {
		bodies.length = 0;
		const provider = createUnlimitedOcrProvider(settings(), {
			capture: async () => capture("a.pdf", "application/pdf"),
			renderPages: pages(1),
		});
		await provider.extract!("https://e.example/a.pdf");
		assert.equal("custom_logit_processor" in bodies[0], false);
		assert.equal("custom_params" in bodies[0], false);
	});

	it("batches pages and uses the single-page window for a lone image", async () => {
		bodies.length = 0;
		const provider = createUnlimitedOcrProvider(settings({ pagesPerRequest: 2, logitProcessor: "LP" }), {
			capture: async () => capture("a.pdf", "application/pdf"),
			renderPages: pages(3),
		});
		await provider.extract!("https://e.example/a.pdf");
		assert.deepEqual(bodies.map((b) => b.messages[0].content.length), [3, 2]);
		assert.deepEqual(bodies.map((b) => b.custom_params.window_size), [1024, 128]);
	});

	it("reads an image directly and rejects HTML so the chain falls through", async () => {
		bodies.length = 0;
		const image = createUnlimitedOcrProvider(settings(), { capture: async () => capture("s.png", "image/png") });
		await image.extract!("https://e.example/s.png");
		assert.match(bodies[0].messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
		const html = createUnlimitedOcrProvider(settings(), { capture: async () => capture("p.html", "text/html") });
		await assert.rejects(() => html.extract!("https://e.example/p.html"), /PDFs and images/);
	});

	it("surfaces server errors and empty output", async () => {
		const provider = createUnlimitedOcrProvider(settings(), {
			capture: async () => capture("a.pdf", "application/pdf"),
			renderPages: pages(1),
		});
		status = 500;
		await assert.rejects(() => provider.extract!("https://e.example/a.pdf"), /error 500/);
		status = 200;
		reply = "<PAGE>  ";
		await assert.rejects(() => provider.extract!("https://e.example/a.pdf"), /no text/);
		reply = "<PAGE># Title\nPage one<PAGE>Page two";
	});

	it("cleans special tokens", () => {
		assert.equal(cleanOcrOutput("<PAGE>hi<｜end▁of▁sentence｜>"), "hi");
	});
});
