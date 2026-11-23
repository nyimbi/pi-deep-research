import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { chainBatchSearch, chainExtract, chainSearch, chainSearchAll } from "../src/chain.ts";
import { SourceLedger } from "../src/ledger.ts";
import { JsonCache, ProviderBreaker, UnsafeUrlError } from "../src/runtime.ts";
import type { ExtractResult, SearchProvider, SearchResult } from "../src/types.ts";

const dirs: string[] = [];
async function cacheDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-chain-"));
	dirs.push(dir);
	return dir;
}
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const hit = (url: string, title = url): SearchResult => ({ title, url, snippet: title });
const policy = { allowPrivateHosts: false, allowedHosts: [], blockedHosts: [], allowedPorts: [80, 443] };

function provider(name: string, overrides: Partial<SearchProvider> = {}): SearchProvider {
	return {
		name,
		tier: "cloud",
		isConfigured: () => true,
		search: async () => [],
		...overrides,
	};
}

describe("cache", () => {
	it("serves a second identical search from disk and records the cache hit", async () => {
		let calls = 0;
		const cache = new JsonCache(await cacheDir());
		const ledger = new SourceLedger();
		const p = provider("a", { search: async () => { calls += 1; return [hit("https://x")]; } });
		const first = await chainSearch([p], "q", { maxResults: 5, cache, ledger });
		const second = await chainSearch([p], "q", { maxResults: 5, cache, ledger });
		assert.equal(calls, 1);
		assert.equal(first.cached, false);
		assert.equal(second.cached, true);
		assert.equal(ledger.stats().cacheHits, 1);
	});
	it("serves a repeated extraction from cache", async () => {
		let calls = 0;
		const cache = new JsonCache(await cacheDir());
		const p = provider("a", {
			extract: async (url): Promise<ExtractResult> => {
				calls += 1;
				return { title: "T", url, content: "body", wordCount: 1, provider: "a" };
			},
		});
		await chainExtract([p], "https://x", { cache });
		await chainExtract([p], "https://x", { cache });
		assert.equal(calls, 1);
	});
});

describe("breaker", () => {
	it("skips a provider after repeated failures", async () => {
		const breaker = new ProviderBreaker({ failures: 1, cooldownMs: 60_000 });
		const bad = provider("bad", { search: async () => { throw new Error("down"); } });
		const good = provider("good", { search: async () => [hit("https://good")] });
		const first = await chainSearch([bad, good], "q", { maxResults: 5, breaker });
		assert.equal(first.provider, "good");
		const second = await chainSearch([bad, good], "q", { maxResults: 5, breaker });
		assert.equal(second.provider, "good");
		assert.equal(second.attempts[0].status, "skipped");
		assert.equal(second.attempts[0].reason, "circuit open");
	});
});

describe("merge", () => {
	it("deduplicates a URL found by two providers and keeps unique results", async () => {
		const a = provider("a", { search: async () => [hit("https://one/x"), hit("https://a-only")] });
		const b = provider("b", { search: async () => [hit("https://one/x?utm_source=b", "one again"), hit("https://b-only")] });
		const result = await chainSearchAll([a, b], "q", { maxResults: 10 });
		assert.equal(result.provider, "merged");
		const urls = result.results.map((item) => item.url);
		assert.equal(urls.filter((url) => url.includes("one/x")).length, 1);
		assert.equal(urls.length, 3);
	});
});

describe("safety", () => {
	it("refuses a private URL before a provider is called", async () => {
		let called = 0;
		const p = provider("a", {
			extract: async (url): Promise<ExtractResult> => {
				called += 1;
				return { title: "T", url, content: "body", wordCount: 1, provider: "a" };
			},
		});
		await assert.rejects(chainExtract([p], "http://127.0.0.1/secret", { safety: policy }), UnsafeUrlError);
		assert.equal(called, 0);
	});
});

describe("batch", () => {
	it("reports per-query results and failures", async () => {
		const p = provider("a", {
			search: async (request) => {
				if (request.query === "bad") throw new Error("provider exploded");
				return [hit(`https://x/${encodeURIComponent(request.query)}`)];
			},
		});
		const outcome = await chainBatchSearch([p], ["good", "bad"], { maxResults: 5 });
		assert.equal(outcome.results.good.length, 1);
		assert.equal(outcome.results.bad.length, 0);
		assert.match(outcome.failures.bad, /provider exploded/);
	});
});
