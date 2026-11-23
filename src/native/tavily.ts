import type { ExtractResult, SearchProvider, SearchRequest, SearchResult } from "../types.ts";

interface TavilyResponse {
	results: Array<{ title: string; url: string; content: string; score: number; published_date?: string }>;
}

interface TavilyExtractResponse {
	results?: Array<{ url: string; raw_content?: string; title?: string }>;
	failed_results?: Array<{ url: string; error?: string }>;
}

/** Native Tavily provider — same endpoint, params, and response mapping as v0.1.6. */
export function createTavilyProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "tavily",
		tier: "cloud",
		isConfigured: () => Boolean(process.env.TAVILY_API_KEY),
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const apiKey = process.env.TAVILY_API_KEY;
			if (!apiKey) throw new Error("TAVILY_API_KEY not set");

			const body: Record<string, unknown> = {
				query: req.query,
				max_results: req.maxResults,
				search_depth: req.searchDepth ?? "basic",
				include_answer: false,
			};
			if (req.includeDomains?.length) body.include_domains = req.includeDomains;
			if (req.excludeDomains?.length) body.exclude_domains = req.excludeDomains;
			if (req.freshnessDays && req.freshnessDays > 0) body.days = req.freshnessDays;

			const resp = await fetchImpl("https://api.tavily.com/search", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify(body),
				signal: req.signal,
			});

			if (!resp.ok) {
				const text = await resp.text();
				throw new Error(`Tavily API error ${resp.status}: ${text}`);
			}

			const data = (await resp.json()) as TavilyResponse;
			return data.results.map((r) => ({
				title: r.title,
				url: r.url,
				snippet: r.content,
				score: r.score,
				publishedDate: r.published_date,
			}));
		},
		async extract(url: string, signal?: AbortSignal): Promise<ExtractResult> {
			const apiKey = process.env.TAVILY_API_KEY;
			if (!apiKey) throw new Error("TAVILY_API_KEY not set");
			const response = await fetchImpl("https://api.tavily.com/extract", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({ urls: [url], include_images: false, extract_depth: "advanced" }),
				signal,
			});
			if (!response.ok) {
				throw new Error(`Tavily extract error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			}
			const data = (await response.json()) as TavilyExtractResponse;
			const failed = data.failed_results?.find((item) => item.url === url);
			if (failed) throw new Error(`Tavily extract failed for ${url}: ${failed.error ?? "unknown error"}`);
			const content = data.results?.find((item) => item.url === url)?.raw_content ?? "";
			if (!content.trim()) throw new Error(`Tavily extract returned no content for ${url}`);
			const title = data.results?.find((item) => item.url === url)?.title || new URL(url).hostname;
			return {
				title,
				url,
				content,
				wordCount: content.split(/\s+/).filter(Boolean).length,
				provider: "tavily",
			};
		},
	};
}
