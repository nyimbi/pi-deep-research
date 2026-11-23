import type { SearchProvider, SearchRequest, SearchResult } from "../types.ts";

function decode(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/\s+/g, " ")
		.trim();
}

function tag(block: string, name: string): string {
	const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
	return match ? decode(match[1]) : "";
}

/** arXiv Atom API; no key required. */
export function createArxivProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "arxiv",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const query = req.query.replace(/["\\]/g, " ").trim();
			if (!query) return [];
			const params = new URLSearchParams({
				search_query: `all:"${query}"`,
				start: "0",
				max_results: String(Math.min(req.maxResults, 20)),
				sortBy: "relevance",
				sortOrder: "descending",
			});
			const response = await fetchImpl(`https://export.arxiv.org/api/query?${params}`, { signal: req.signal });
			if (!response.ok) {
				throw new Error(`arXiv API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			}
			const xml = await response.text();
			const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
			return entries
				.map((entry) => {
					const url = tag(entry, "id").replace("http://", "https://");
					return {
						title: tag(entry, "title"),
						url,
						snippet: tag(entry, "summary"),
						publishedDate: tag(entry, "published").slice(0, 10) || undefined,
					};
				})
				.filter((item) => item.url && item.title)
				.slice(0, req.maxResults);
		},
	};
}
