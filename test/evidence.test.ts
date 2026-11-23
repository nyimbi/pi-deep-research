import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceLedger } from "../src/ledger.ts";
import { classifyTier, mergeResults, normalizeUrl } from "../src/normalize.ts";
import type { SearchResult } from "../src/types.ts";

describe("normalizeUrl", () => {
	it("strips tracking, fragments, default ports, and a trailing slash", () => {
		assert.equal(
			normalizeUrl("HTTPS://Example.COM:443/docs/?utm_source=x&b=2&a=1#frag"),
			"https://example.com/docs?a=1&b=2",
		);
	});
	it("keeps a root path and a meaningful query", () => {
		assert.equal(normalizeUrl("https://example.com/?q=1"), "https://example.com/?q=1");
	});
	it("returns unparseable input unchanged", () => {
		assert.equal(normalizeUrl("not a url"), "not a url");
	});
});

describe("classifyTier", () => {
	it("ranks official, academic, media, community, and unknown sources", () => {
		assert.equal(classifyTier("https://www.ietf.org/rfc"), 1);
		assert.equal(classifyTier("https://arxiv.org/abs/1"), 1);
		assert.equal(classifyTier("https://reuters.com/story"), 2);
		assert.equal(classifyTier("https://stackoverflow.com/q/1"), 3);
		assert.equal(classifyTier("https://random.example.com/x"), 4);
	});
});

describe("mergeResults", () => {
	const hit = (url: string, title = url): SearchResult => ({ title, url, snippet: title });
	it("deduplicates URLs across providers and prefers the one found by more providers", () => {
		const merged = mergeResults(
			[
				{ provider: "a", results: [hit("https://one.example/x", "one-a"), hit("https://two.example/y", "two")] },
				{ provider: "b", results: [hit("https://one.example/x?utm_source=b", "one-b")] },
			],
			10,
		);
		assert.equal(merged.length, 2);
		assert.equal(merged[0].url, "https://one.example/x");
	});
	it("caps the merged list", () => {
		const merged = mergeResults([{ provider: "a", results: [hit("https://a/1"), hit("https://a/2"), hit("https://a/3")] }], 2);
		assert.equal(merged.length, 2);
	});
});

describe("SourceLedger", () => {
	it("deduplicates searches, records extraction, and validates citations", () => {
		const ledger = new SourceLedger();
		ledger.recordSearch("searxng", "q1", [
			{ title: "Spec", url: "https://example.com/spec?utm_source=x", snippet: "s" },
			{ title: "Other", url: "https://other.example/page", snippet: "o" },
		]);
		ledger.recordSearch("tavily", "q2", [{ title: "Spec again", url: "https://example.com/spec", snippet: "better" }]);
		ledger.recordExtract("https://example.com/spec", {
			title: "Spec",
			url: "https://example.com/spec",
			content: "authoritative body",
			wordCount: 2,
			provider: "tavily",
		});
		const stats = ledger.stats("See [spec](https://example.com/spec) and [missing](https://missing.example/x).");
		assert.equal(stats.sources, 2);
		assert.equal(stats.extracted, 1);
		assert.equal(stats.searches, 2);
		assert.equal(stats.extracts, 1);
		assert.equal(stats.unknownCitations, 1);
		const known = ledger.citations("See https://example.com/spec").known;
		assert.equal(known.length, 1);
		assert.equal(normalizeUrl(known[0]), "https://example.com/spec");
	});
	it("reports an exhausted budget", () => {
		const ledger = new SourceLedger();
		ledger.recordSearch("a", "q", []);
		assert.match(ledger.budgetExceeded(1, 5) ?? "", /search budget/);
		assert.equal(ledger.budgetExceeded(2, 5), null);
	});
});
