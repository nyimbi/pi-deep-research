import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chainBatchSearch } from "../src/chain.ts";
import { dropNearDuplicates, filterFresh, hamming, mmrSelect, refineResults, simhash } from "../src/dedupe.ts";
import type { SearchProvider, SearchResult } from "../src/types.ts";

const r = (url: string, title: string, snippet = "", publishedDate?: string): SearchResult => ({ url, title, snippet, publishedDate });
const PR = "Acme announces record quarterly revenue of four billion dollars driven by strong cloud demand across all regions";

describe("near-duplicate removal", () => {
	it("collapses five copies of one press release to one result", () => {
		const copies = [0, 1, 2, 3, 4].map((i) => r(`https://site${i}.example/pr`, "Acme record revenue", `${PR}${i === 2 ? " today" : ""}`));
		const other = r("https://other.example/x", "Weather", "Rain is expected across the northern regions this weekend with cold nights");
		const out = dropNearDuplicates([...copies, other]);
		assert.deepEqual(out.map((x) => x.url), ["https://site0.example/pr", "https://other.example/x"]);
	});

	it("keeps unrelated text far apart in hash space", () => {
		const a = simhash("the quick brown fox jumps over the lazy dog near the river bank");
		const b = simhash("quarterly earnings guidance was raised after strong cloud demand in europe");
		assert.ok(hamming(a, b) > 10);
	});

	it("keeps short results rather than guessing", () => {
		assert.equal(dropNearDuplicates([r("https://a/1", "Home"), r("https://b/2", "Home")]).length, 2);
	});
});

describe("diversity and freshness", () => {
	it("mmr promotes a different topic over a close paraphrase", () => {
		const a = r("https://a/1", "rust async runtime tokio guide", "tokio runtime tasks guide");
		const b = r("https://a/2", "rust async runtime tokio guide two", "tokio runtime tasks guide again");
		const c = r("https://a/3", "garbage collection in go", "go gc pause tuning");
		assert.deepEqual(mmrSelect([a, b, c], 2).map((x) => x.url), ["https://a/1", "https://a/3"]);
	});

	it("excludes a year-old result when freshness is set and keeps undated ones", () => {
		const now = Date.parse("2026-11-23");
		const out = filterFresh([r("https://a/old", "t", "", "2025-11-01"), r("https://a/new", "t", "", "2026-11-01"), r("https://a/none", "t")], 30, now);
		assert.deepEqual(out.map((x) => x.url), ["https://a/new", "https://a/none"]);
		assert.equal(filterFresh([r("https://a/old", "t", "", "2020-01-01")], undefined, now).length, 1);
	});

	it("applies to every query in a batch", async () => {
		const provider: SearchProvider = {
			name: "fake",
			tier: "local",
			isConfigured: () => true,
			search: async () => [0, 1, 2].map((i) => r(`https://s${i}.example/pr`, "Acme record revenue", PR)),
		};
		const out = await chainBatchSearch([provider], ["q"], { maxResults: 5 });
		assert.equal(out.results.q.length, 1);
		assert.equal(refineResults([], { maxResults: 3 }).length, 0);
	});
});
