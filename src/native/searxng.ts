import type { SearxngSettings } from "../settings.ts";
import type { SearchProvider, SearchRequest, SearchResult } from "../types.ts";

interface SearxngResponse {
	results?: Array<{
		title?: string;
		url?: string;
		content?: string;
		publishedDate?: string;
		pubdate?: string;
		score?: number;
		engine?: string;
	}>;
}

function timeRange(days: number | undefined): string | null {
	if (!days || days <= 0) return null;
	if (days <= 1) return "day";
	if (days <= 7) return "week";
	if (days <= 31) return "month";
	return "year";
}

/** Self-hosted metasearch. Requires the instance to allow `format=json`. */
export function createSearxngProvider(
	settings: SearxngSettings,
	fetchImpl: typeof fetch = globalThis.fetch,
): SearchProvider {
	return {
		name: "searxng",
		tier: "cloud",
		isConfigured: () => Boolean(settings.baseUrl),
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const base = settings.baseUrl.replace(/\/+$/, "");
			if (!base) throw new Error("searxng.base_url is not configured");
			const params = new URLSearchParams({
				q: req.query,
				format: "json",
				language: settings.language,
				categories: settings.categories,
				safesearch: String(settings.safeSearch),
			});
			if (settings.engines.length) params.set("engines", settings.engines.join(","));
			const range = timeRange(req.freshnessDays);
			if (range) params.set("time_range", range);
			const response = await fetchImpl(`${base}/search?${params}`, { signal: req.signal });
			if (!response.ok) {
				const text = (await response.text()).slice(0, 300);
				if (response.status === 403 || /<html/i.test(text)) {
					throw new Error(
						`SearXNG search error ${response.status}: JSON API is disabled; add "json" under search.formats in settings.yml`,
					);
				}
				throw new Error(`SearXNG search error ${response.status}: ${text}`);
			}
			const contentType = response.headers.get("content-type") ?? "";
			const raw = await response.text();
			if (!contentType.includes("json") && /^\s*</.test(raw)) {
				throw new Error("SearXNG returned HTML, not JSON; enable the json output format in settings.yml");
			}
			const data = JSON.parse(raw) as SearxngResponse;
			return (data.results ?? [])
				.filter((item) => item.url && item.title)
				.slice(0, req.maxResults)
				.map((item) => ({
					title: item.title ?? "",
					url: item.url ?? "",
					snippet: item.content ?? "",
					score: typeof item.score === "number" ? item.score : undefined,
					publishedDate: item.publishedDate ?? item.pubdate,
				}));
		},
	};
}
