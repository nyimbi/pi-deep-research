import type { ExtractResult, SearchProvider, SearchRequest } from "../types.ts";

/**
 * Jina Reader: extraction only. It handles JavaScript-rendered pages and PDFs,
 * which the basic fetch fallback cannot. `search` returns an empty list so the
 * chain skips it without an error; keep it after the search providers.
 */
export function createJinaProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "jina",
		tier: "cloud",
		isConfigured: () => process.env.JINA_API_KEY !== "off",
		search: async (_req: SearchRequest) => [],
		async extract(url: string, signal?: AbortSignal): Promise<ExtractResult> {
			const headers: Record<string, string> = { Accept: "text/plain" };
			const key = process.env.JINA_API_KEY;
			if (key && key !== "off") headers.Authorization = `Bearer ${key}`;
			const response = await fetchImpl(`https://r.jina.ai/${url}`, { headers, signal });
			if (!response.ok) {
				throw new Error(`Jina Reader error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			}
			const text = await response.text();
			if (!text.trim()) throw new Error(`Jina Reader returned no content for ${url}`);
			const titleMatch = text.match(/^Title:\s*(.+)$/m);
			const bodyStart = text.search(/^Markdown Content:\s*$/m);
			const content = bodyStart >= 0 ? text.slice(text.indexOf("\n", bodyStart) + 1).trim() : text.trim();
			return {
				title: titleMatch?.[1]?.trim() || new URL(url).hostname,
				url,
				content,
				wordCount: content.split(/\s+/).filter(Boolean).length,
				provider: "jina",
			};
		},
	};
}
