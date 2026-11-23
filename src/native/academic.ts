import type { SearchProvider, SearchRequest, SearchResult } from "../types.ts";

/** Rebuild an OpenAlex abstract from its inverted index. */
function openalexAbstract(index: Record<string, number[]> | null | undefined): string {
	if (!index) return "";
	const positioned: Array<[number, string]> = [];
	for (const [word, positions] of Object.entries(index)) {
		for (const position of positions) positioned.push([position, word]);
	}
	return positioned.sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(" ").slice(0, 600);
}

function stripJats(value: string): string {
	return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function createOpenAlexProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "openalex",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({ search: req.query, "per-page": String(Math.min(req.maxResults, 25)) });
			if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
			if (process.env.CROSSREF_MAILTO) params.set("mailto", process.env.CROSSREF_MAILTO);
			const response = await fetchImpl(`https://api.openalex.org/works?${params}`, { signal: req.signal });
			if (!response.ok) throw new Error(`OpenAlex API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			const data = (await response.json()) as {
				results?: Array<{
					display_name?: string;
					doi?: string | null;
					id?: string;
					publication_year?: number;
					abstract_inverted_index?: Record<string, number[]> | null;
				}>;
			};
			return (data.results ?? [])
				.filter((paper) => paper.display_name && (paper.doi || paper.id))
				.slice(0, req.maxResults)
				.map((paper) => ({
					title: paper.display_name ?? "",
					url: paper.doi ?? paper.id ?? "",
					snippet: openalexAbstract(paper.abstract_inverted_index),
					publishedDate: paper.publication_year ? String(paper.publication_year) : undefined,
				}));
		},
	};
}

export function createCrossrefProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "crossref",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({ query: req.query, rows: String(Math.min(req.maxResults, 20)) });
			const mailto = process.env.CROSSREF_MAILTO;
			if (mailto) params.set("mailto", mailto);
			const response = await fetchImpl(`https://api.crossref.org/works?${params}`, { signal: req.signal });
			if (!response.ok) throw new Error(`Crossref API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			const data = (await response.json()) as {
				message?: {
					items?: Array<{
						title?: string[];
						DOI?: string;
						abstract?: string;
						issued?: { "date-parts"?: number[][] };
						"container-title"?: string[];
					}>;
				};
			};
			return (data.message?.items ?? [])
				.filter((paper) => paper.title?.[0] && paper.DOI)
				.slice(0, req.maxResults)
				.map((paper) => ({
					title: paper.title?.[0] ?? "",
					url: `https://doi.org/${paper.DOI}`,
					snippet: paper.abstract ? stripJats(paper.abstract) : paper["container-title"]?.[0] ?? "",
					publishedDate: paper.issued?.["date-parts"]?.[0]?.map(String).join("-"),
				}));
		},
	};
}

export function createEuropePmcProvider(fetchImpl: typeof fetch = globalThis.fetch): SearchProvider {
	return {
		name: "europe-pmc",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({
				query: req.query,
				format: "json",
				pageSize: String(Math.min(req.maxResults, 25)),
				resultType: "core",
			});
			const response = await fetchImpl(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`, {
				signal: req.signal,
			});
			if (!response.ok) throw new Error(`Europe PMC API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
			const data = (await response.json()) as {
				resultList?: {
					result?: Array<{
						title?: string;
						doi?: string;
						id?: string;
						source?: string;
						abstractText?: string;
						pubYear?: string;
						journalTitle?: string;
					}>;
				};
			};
			return (data.resultList?.result ?? [])
				.filter((paper) => paper.title)
				.slice(0, req.maxResults)
				.map((paper) => ({
					title: paper.title ?? "",
					url: paper.doi
						? `https://doi.org/${paper.doi}`
						: `https://europepmc.org/article/${paper.source ?? "MED"}/${paper.id ?? ""}`,
					snippet: paper.abstractText ?? paper.journalTitle ?? "",
					publishedDate: paper.pubYear,
				}));
		},
	};
}
