import type { OllamaSettings } from "../settings.ts";
import type { ExtractResult, SearchProvider, SearchRequest, SearchResult } from "../types.ts";

interface OllamaSearchResponse {
	results?: Array<{ title?: string; url?: string; content?: string }>;
}

interface OllamaFetchResponse {
	title?: string;
	content?: string;
	links?: string[];
}

function hostBase(settings: OllamaSettings): string {
	const raw = (process.env.OLLAMA_HOST ?? settings.host ?? "127.0.0.1").trim();
	const port = (process.env.OLLAMA_PORT ?? settings.port ?? "11434").trim() || "11434";
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw || "127.0.0.1"}`;
	const parsed = new URL(withScheme);
	if (!parsed.port) parsed.port = port;
	return parsed.origin;
}

async function detail(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	return text.replace(/\s+/g, " ").trim().slice(0, 200) || response.statusText;
}

/**
 * Ollama's experimental web search. On the Ollama app this proxies the
 * signed-in cloud service; the host may be a local daemon or a cloud endpoint.
 */
export function createOllamaProvider(
	settings: OllamaSettings,
	fetchImpl: typeof fetch = globalThis.fetch,
): SearchProvider {
	return {
		name: "ollama",
		tier: "local",
		isConfigured: () => settings.enabled && process.env.OLLAMA_WEB_SEARCH !== "off",
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const response = await fetchImpl(`${hostBase(settings)}/api/experimental/web_search`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: req.query, max_results: req.maxResults }),
				signal: req.signal,
			});
			if (!response.ok) {
				if (response.status === 401) throw new Error("Ollama search is unauthorized; run `ollama signin`");
				throw new Error(`Ollama search error ${response.status}: ${await detail(response)}`);
			}
			const data = (await response.json()) as OllamaSearchResponse;
			return (data.results ?? [])
				.filter((item) => item.url && item.title)
				.slice(0, req.maxResults)
				.map((item) => ({
					title: item.title ?? "",
					url: item.url ?? "",
					snippet: item.content ?? "",
				}));
		},
		async extract(url: string, signal?: AbortSignal): Promise<ExtractResult> {
			const response = await fetchImpl(`${hostBase(settings)}/api/experimental/web_fetch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url }),
				signal,
			});
			if (!response.ok) {
				if (response.status === 401) throw new Error("Ollama fetch is unauthorized; run `ollama signin`");
				throw new Error(`Ollama fetch error ${response.status}: ${await detail(response)}`);
			}
			const data = (await response.json()) as OllamaFetchResponse;
			const content = data.content ?? "";
			if (!content.trim()) throw new Error(`Ollama fetch returned no content for ${url}`);
			return {
				title: data.title || new URL(url).hostname,
				url,
				content,
				wordCount: content.split(/\s+/).filter(Boolean).length,
				provider: "ollama",
			};
		},
	};
}
