import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createCrossrefProvider, createEuropePmcProvider, createOpenAlexProvider } from "../src/native/academic.ts";

let calls: Array<{ url: string; init: RequestInit }> = [];
function mockFetch(handler: (url: string) => Response): typeof fetch {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return handler(String(url));
	}) as typeof fetch;
}
function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
	calls = [];
});
afterEach(() => {
	delete process.env.OPENALEX_API_KEY;
	delete process.env.CROSSREF_MAILTO;
});

describe("openalex", () => {
	it("reconstructs an abstract and maps DOI/year", async () => {
		process.env.OPENALEX_API_KEY = "oa-key";
		const provider = createOpenAlexProvider(mockFetch(() =>
			json({
				results: [{
					display_name: "A paper",
					doi: "https://doi.org/10.1/x",
					publication_year: 2025,
					abstract_inverted_index: { Hello: [0], world: [1] },
				}],
			}),
		));
		const results = await provider.search({ query: "q", maxResults: 2 });
		assert.equal(results[0].title, "A paper");
		assert.equal(results[0].url, "https://doi.org/10.1/x");
		assert.equal(results[0].snippet, "Hello world");
		const url = new URL(calls[0].url);
		assert.equal(url.searchParams.get("search"), "q");
		assert.equal(url.searchParams.get("api_key"), "oa-key");
	});
});

describe("crossref", () => {
	it("strips JATS markup and builds a DOI URL", async () => {
		process.env.CROSSREF_MAILTO = "research@example.org";
		const provider = createCrossrefProvider(mockFetch(() =>
			json({
				message: {
					items: [{
						title: ["A paper"],
						DOI: "10.1/x",
						abstract: "<jats:p>Abstract text.</jats:p>",
						issued: { "date-parts": [[2025, 3]] },
						"container-title": ["Journal"],
					}],
				},
			}),
		));
		const results = await provider.search({ query: "q", maxResults: 2 });
		assert.equal(results[0].url, "https://doi.org/10.1/x");
		assert.equal(results[0].snippet, "Abstract text.");
		assert.equal(results[0].publishedDate, "2025-3");
		assert.equal(new URL(calls[0].url).searchParams.get("mailto"), "research@example.org");
	});
});

describe("europe pmc", () => {
	it("maps a biomedical record and prefers the DOI", async () => {
		const provider = createEuropePmcProvider(mockFetch(() =>
			json({
				resultList: {
					result: [{ title: "A paper", doi: "10.1/x", abstractText: "Abstract", pubYear: "2024", source: "MED", id: "1" }],
				},
			}),
		));
		const results = await provider.search({ query: "q", maxResults: 2 });
		assert.equal(results[0].url, "https://doi.org/10.1/x");
		assert.equal(results[0].snippet, "Abstract");
		assert.equal(results[0].publishedDate, "2024");
	});
});
