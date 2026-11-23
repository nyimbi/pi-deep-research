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

function instances(settings: SearxngSettings): string[] {
	return [...new Set([settings.baseUrl, ...(settings.fallbackUrls ?? [])].map((url) => url.trim().replace(/\/+$/, "")).filter(Boolean))];
}

/**
 * Self-hosted metasearch. Requires the instance to allow `format=json`.
 * `baseUrl` is tried first, then each `fallbackUrls` entry; the first non-empty
 * response wins, so a local instance can sit in front of a remote one.
 */
export function createSearxngProvider(
	settings: SearxngSettings,
	fetchImpl: typeof fetch = globalThis.fetch,
): SearchProvider {
	const searchOne = async (base: string, req: SearchRequest): Promise<SearchResult[]> => {
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
					`SearXNG ${base} error ${response.status}: JSON API is disabled; add "json" under search.formats in settings.yml`,
				);
			}
			throw new Error(`SearXNG ${base} error ${response.status}: ${text}`);
		}
		const contentType = response.headers.get("content-type") ?? "";
		const raw = await response.text();
		if (!contentType.includes("json") && /^\s*</.test(raw)) {
			throw new Error(`SearXNG ${base} returned HTML, not JSON; enable the json output format`);
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
	};

	return {
		name: "searxng",
		tier: "cloud",
		isConfigured: () => instances(settings).length > 0,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const candidates = instances(settings);
			if (candidates.length === 0) throw new Error("searxng.base_url is not configured");
			let lastError: Error | null = null;
			let sawEmpty = false;
			for (const base of candidates) {
				try {
					const results = await searchOne(base, req);
					if (results.length > 0) return results;
					sawEmpty = true;
				} catch (error) {
					lastError = error instanceof Error ? error : new Error(String(error));
				}
			}
			if (lastError && !sawEmpty) throw lastError;
			return [];
		},
	};
}
