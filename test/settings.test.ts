import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSettings } from "../src/settings.ts";

const CONFIG = JSON.stringify({
	providers: ["searxng", "ollama", "tavily"],
	timeout_ms: 60_000,
	retries: 4,
	batch_concurrency: 2,
	merge: true,
	cache: { enabled: true, dir: "/tmp/pi-cache", search_ttl_seconds: 120, extract_ttl_seconds: 3600 },
	breaker: { failures: 5, cooldown_seconds: 30 },
	searxng: { base_url: "http://127.0.0.1:3501", fallback_urls: ["https://search.example.org"], engines: ["duckduckgo"], categories: "general" },
	ollama: { enabled: false },
	safety: { allow_private_hosts: false, allowed_hosts: ["Docs.Internal"], allowed_ports: [443] },
	budget: { max_searches: 10, max_extracts: 4 },
});

describe("loadSettings", () => {
	it("reads the config file and converts seconds to milliseconds", async () => {
		const settings = await loadSettings({ env: {}, readFileImpl: async () => CONFIG });
		assert.deepEqual(settings.providers, ["searxng", "ollama", "tavily"]);
		assert.equal(settings.timeoutMs, 60_000);
		assert.equal(settings.retries, 4);
		assert.equal(settings.batchConcurrency, 2);
		assert.equal(settings.merge, true);
		assert.equal(settings.cache.searchTtlMs, 120_000);
		assert.equal(settings.cache.extractTtlMs, 3_600_000);
		assert.equal(settings.breaker.cooldownMs, 30_000);
		assert.equal(settings.searxng.baseUrl, "http://127.0.0.1:3501");
		assert.deepEqual(settings.searxng.fallbackUrls, ["https://search.example.org"]);
		assert.deepEqual(settings.safety.allowedHosts, ["docs.internal"]);
		assert.equal(settings.budget.maxExtracts, 4);
	});
	it("uses defaults when the file is absent", async () => {
		const error = Object.assign(new Error("missing"), { code: "ENOENT" });
		const settings = await loadSettings({ env: {}, readFileImpl: async () => { throw error; } });
		assert.deepEqual(settings.providers, ["tavily", "brave", "agent-reach"]);
		assert.equal(settings.timeoutMs, 45_000);
	});
	it("lets environment overrides win", async () => {
		const settings = await loadSettings({
			env: {
				SEARCH_PROVIDERS: "ollama,searxng",
				SEARCH_TIMEOUT_MS: "90000",
				SEARXNG_BASE_URL: "https://env.example",
				SEARXNG_FALLBACK_URLS: "https://fleet.example",
				OLLAMA_HOST: "10.0.0.1",
				OLLAMA_PORT: "9999",
				OLLAMA_WEB_SEARCH: "off",
			},
			readFileImpl: async () => CONFIG,
		});
		assert.deepEqual(settings.providers, ["ollama", "searxng"]);
		assert.equal(settings.timeoutMs, 90_000);
		assert.equal(settings.searxng.baseUrl, "https://env.example");
		assert.deepEqual(settings.searxng.fallbackUrls, ["https://fleet.example"]);
		assert.equal(settings.ollama.host, "10.0.0.1");
		assert.equal(settings.ollama.port, "9999");
		assert.equal(settings.ollama.enabled, false);
	});
	it("rejects malformed JSON and a wrong field type", async () => {
		await assert.rejects(loadSettings({ env: {}, readFileImpl: async () => "{broken" }), /JSON/);
		await assert.rejects(
			loadSettings({ env: {}, readFileImpl: async () => JSON.stringify({ retries: "many" }) }),
			/retries/,
		);
	});
});

describe("unlimited_ocr settings", () => {
	it("is off by default and reads config plus env override", async () => {
		const off = await loadSettings({ env: {}, readFileImpl: async () => "{}" });
		assert.equal(off.uocr.baseUrl, "");
		const on = await loadSettings({
			env: { UOCR_BASE_URL: "http://127.0.0.1:10000/" },
			readFileImpl: async () => JSON.stringify({ unlimited_ocr: { max_pages: 5, crop_mode: false } }),
		});
		assert.equal(on.uocr.baseUrl, "http://127.0.0.1:10000");
		assert.equal(on.uocr.maxPages, 5);
		assert.equal(on.uocr.cropMode, false);
	});
});

describe("diagram style settings", () => {
	it("defaults to the editorial style with the skill in ~/.claude, and reads config and env", async () => {
		const d = (await loadSettings({ env: {}, readFileImpl: async () => "{}" })).diagrams;
		assert.equal(d.style, "editorial");
		assert.match(d.designSkillDir, /\.claude\/skills\/diagram-design$/);
		const c = (await loadSettings({ env: {}, readFileImpl: async () => JSON.stringify({ diagrams: { style: "mermaid", design_skill_dir: "/opt/dd" } }) })).diagrams;
		assert.equal(c.style, "mermaid");
		assert.equal(c.designSkillDir, "/opt/dd");
		assert.equal((await loadSettings({ env: { DIAGRAM_STYLE: "mermaid" }, readFileImpl: async () => "{}" })).diagrams.style, "mermaid");
	});
	it("rejects an unknown style instead of guessing", async () => {
		await assert.rejects(loadSettings({ env: { DIAGRAM_STYLE: "fancy" }, readFileImpl: async () => "{}" }), /editorial.*mermaid/);
	});
});
