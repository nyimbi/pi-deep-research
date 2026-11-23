import type { SearchProvider, SearchRequest, SearchResult } from "../types.ts";

interface SemanticScholarResponse {
	data?: Array<{
		paperId?: string;
		title?: string;
		url?: string;
		abstract?: string | null;
		year?: number | null;
		venue?: string | null;
	}>;
}

/** Semantic Scholar paper search; optional SEMANTIC_SCHOLAR_API_KEY raises the rate limit. */
export function createSemanticScholarProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "semantic-scholar",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({
				query: req.query,
				limit: String(Math.min(req.maxResults, 20)),
				fields: "title,url,abstract,year,venue,paperId",
			});
			const headers: Record<string, string> = { Accept: "application/json" };
			const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
			if (key) headers["x-api-key"] = key;
			const response = await fetchImpl(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
				headers,
				signal: req.signal,
			});
			if (!response.ok) {
				throw new Error(`Semantic Scholar API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			}
			const data = (await response.json()) as SemanticScholarResponse;
			return (data.data ?? [])
				.filter((paper) => paper.title && (paper.url || paper.paperId))
				.slice(0, req.maxResults)
				.map((paper) => ({
					title: paper.title ?? "",
					url: paper.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
					snippet: paper.abstract ?? paper.venue ?? "",
					publishedDate: paper.year ? String(paper.year) : undefined,
				}));
		},
	};
}
