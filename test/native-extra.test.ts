import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createArxivProvider } from "../src/native/arxiv.ts";
import { createJinaProvider } from "../src/native/jina.ts";
import { createOllamaProvider } from "../src/native/ollama.ts";
import { createSemanticScholarProvider } from "../src/native/semantic-scholar.ts";
import { createSearxngProvider } from "../src/native/searxng.ts";
import { createTavilyProvider } from "../src/native/tavily.ts";

let calls: Array<{ url: string; init: RequestInit }> = [];
function mockFetch(handler: (url: string) => Response): typeof fetch {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return handler(String(url));
	}) as typeof fetch;
}
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
	calls = [];
});
afterEach(() => {
	delete process.env.TAVILY_API_KEY;
	delete process.env.SEMANTIC_SCHOLAR_API_KEY;
	delete process.env.JINA_API_KEY;
});

const searxng = { baseUrl: "https://sx.example", language: "en", categories: "general", safeSearch: 0, engines: [] };

describe("searxng", () => {
	it("maps results and sends format=json plus a freshness window", async () => {
		const provider = createSearxngProvider(searxng, mockFetch(() =>
			json({ results: [{ title: "T", url: "https://x", content: "s", engine: "duckduckgo", score: 0.4, publishedDate: "2026-11-01" }] }),
		));
		const results = await provider.search({ query: "hello", maxResults: 3, freshnessDays: 7 });
		assert.equal(results.length, 1);
		assert.equal(results[0].publishedDate, "2026-11-01");
		const url = new URL(calls[0].url);
		assert.equal(url.searchParams.get("format"), "json");
		assert.equal(url.searchParams.get("q"), "hello");
		assert.equal(url.searchParams.get("time_range"), "week");
	});
	it("tries the local instance first and falls back to the next instance", async () => {
		const localFirst = createSearxngProvider(
			{ ...searxng, baseUrl: "http://local.example", fallbackUrls: ["https://fleet.example"] },
			mockFetch(() => json({ results: [{ title: "Local", url: "https://local", content: "s" }] })),
		);
		const localResults = await localFirst.search({ query: "q", maxResults: 2 });
		assert.equal(localResults[0].title, "Local");
		assert.equal(calls.length, 1);

		const fallback = createSearxngProvider(
			{ ...searxng, baseUrl: "http://local.example", fallbackUrls: ["https://fleet.example"] },
			mockFetch((url) =>
				url.startsWith("http://local")
					? new Response("down", { status: 500 })
					: json({ results: [{ title: "Fleet", url: "https://fleet", content: "s" }] }),
			),
		);
		const fleetResults = await fallback.search({ query: "q", maxResults: 2 });
		assert.equal(fleetResults[0].title, "Fleet");
		assert.equal(calls.length, 3);
	});
	it("names the JSON API setting when the instance returns HTML", async () => {
		const provider = createSearxngProvider(searxng, mockFetch(() => new Response("<!doctype html>", { status: 403 })));
		await assert.rejects(provider.search({ query: "q", maxResults: 1 }), /JSON API is disabled/);
	});
});

describe("arxiv", () => {
	it("parses Atom entries and decodes entities", async () => {
		const xml = `<feed><entry><id>http://arxiv.org/abs/1234.5678v1</id><title>Visual &amp; Industrial Inspection</title><summary>Abstract text.</summary><published>2026-10-02T12:00:00Z</published></entry></feed>`;
		const provider = createArxivProvider(mockFetch(() => new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } })));
		const results = await provider.search({ query: "visual inspection", maxResults: 2 });
		assert.equal(results[0].title, "Visual & Industrial Inspection");
		assert.equal(results[0].url, "https://arxiv.org/abs/1234.5678v1");
		assert.equal(results[0].publishedDate, "2026-10-02");
	});
});

describe("semantic scholar", () => {
	it("maps papers and sends an API key when present", async () => {
		process.env.SEMANTIC_SCHOLAR_API_KEY = "ss-key";
		const provider = createSemanticScholarProvider(mockFetch(() =>
			json({ data: [{ title: "Paper", paperId: "abc", abstract: "A", year: 2026 }] }),
		));
		const results = await provider.search({ query: "q", maxResults: 2 });
		assert.equal(results[0].url, "https://www.semanticscholar.org/paper/abc");
		assert.equal(results[0].publishedDate, "2026");
		assert.equal((calls[0].init.headers as Record<string, string>)["x-api-key"], "ss-key");
	});
});

describe("jina", () => {
	it("extracts and strips the reader preamble; search is empty", async () => {
		const text = "Title: Example\n\nMarkdown Content:\nThe body text.";
		const provider = createJinaProvider(mockFetch(() => new Response(text, { status: 200 })));
		const result = await provider.extract!("https://example.com");
		assert.equal(result.title, "Example");
		assert.equal(result.content, "The body text.");
		assert.equal(result.provider, "jina");
		assert.deepEqual(await provider.search({ query: "q", maxResults: 1 }), []);
	});
});

describe("ollama", () => {
	it("uses OLLAMA_PORT when the host has no port and maps search/extract", async () => {
		const previousHost = process.env.OLLAMA_HOST;
		const previousPort = process.env.OLLAMA_PORT;
		process.env.OLLAMA_HOST = "127.0.0.1";
		process.env.OLLAMA_PORT = "11434";
		try {
			const provider = createOllamaProvider(
				{ enabled: true, host: "ignored", port: "1" },
				mockFetch((url) =>
					url.includes("web_search")
						? json({ results: [{ title: "T", url: "https://x", content: "s" }] })
						: json({ title: "Page", content: "body", links: [] }),
				),
			);
			const results = await provider.search({ query: "q", maxResults: 2 });
			assert.equal(results[0].snippet, "s");
			assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:11434\//);
			const extracted = await provider.extract!("https://x");
			assert.equal(extracted.title, "Page");
		} finally {
			if (previousHost === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = previousHost;
			if (previousPort === undefined) delete process.env.OLLAMA_PORT; else process.env.OLLAMA_PORT = previousPort;
		}
	});
	it("explains a 401 as a sign-in problem", async () => {
		const provider = createOllamaProvider({ enabled: true, host: "127.0.0.1", port: "11434" }, mockFetch(() => new Response("", { status: 401 })));
		await assert.rejects(provider.search({ query: "q", maxResults: 1 }), /ollama signin/);
	});
});

describe("tavily extract", () => {
	it("maps raw_content and names failed results", async () => {
		process.env.TAVILY_API_KEY = "tvly-test";
		const provider = createTavilyProvider(mockFetch(() => json({ results: [{ url: "https://x", raw_content: "full text", title: "X" }] })));
		const result = await provider.extract?.("https://x");
		assert.equal(result?.content, "full text");
		assert.equal(result?.provider, "tavily");
		const failing = createTavilyProvider(mockFetch(() => json({ failed_results: [{ url: "https://x", error: "blocked" }] })));
		await assert.rejects(failing.extract!("https://x"), /blocked/);
	});
});
