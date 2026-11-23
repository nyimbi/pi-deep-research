/**
 * Domain adapters: public registries with their own search APIs. Each result carries a typed
 * record (kind, id, date, status) beside the usual title, url and snippet. All are opt-in
 * through `sources: "domain"` and go through the same retry and breaker layers as other providers.
 */
import type { SearchProvider, SearchRequest, SearchResult } from "../types.ts";

type Fetch = typeof fetch;

async function getJson<T>(label: string, fetchImpl: Fetch, url: string, init: RequestInit): Promise<T> {
	const response = await fetchImpl(url, init);
	if (!response.ok) throw new Error(`${label} API error ${response.status}: ${(await response.text()).slice(0, 200)}`);
	const text = await response.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		// GDELT and others answer a rate limit with a plain-text 200.
		throw new Error(`${label} returned a non-JSON body (likely rate limited): ${text.slice(0, 120)}`);
	}
}

const trim = (s: string | undefined, n = 400): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** SEC EDGAR full-text search. SEC requires a descriptive User-Agent with contact details, so it is off until SEC_USER_AGENT is set. */
export function createEdgarProvider(fetchImpl: Fetch = globalThis.fetch): SearchProvider {
	return {
		name: "edgar",
		tier: "cloud",
		isConfigured: () => Boolean(process.env.SEC_USER_AGENT),
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({ q: req.query });
			if (req.freshnessDays) {
				const from = new Date(Date.now() - req.freshnessDays * 86_400_000).toISOString().slice(0, 10);
				params.set("dateRange", "custom");
				params.set("startdt", from);
				params.set("enddt", new Date().toISOString().slice(0, 10));
			}
			const data = await getJson<{ hits?: { hits?: Array<{ _id: string; _source: { ciks?: string[]; display_names?: string[]; file_date?: string; form?: string; adsh?: string; period_ending?: string } }> } }>(
				"EDGAR",
				fetchImpl,
				`https://efts.sec.gov/LATEST/search-index?${params}`,
				{ headers: { "User-Agent": process.env.SEC_USER_AGENT ?? "", Accept: "application/json" }, signal: req.signal },
			);
			const out: SearchResult[] = [];
			for (const hit of data.hits?.hits ?? []) {
				const src = hit._source;
				const file = hit._id.split(":")[1];
				const cik = src.ciks?.[0]?.replace(/^0+/, "");
				if (!src.adsh || !file || !cik) continue;
				const name = src.display_names?.[0] ?? `CIK ${cik}`;
				out.push({
					title: `${name}: ${src.form ?? "filing"}${src.period_ending ? ` for period ending ${src.period_ending}` : ""}`,
					url: `https://www.sec.gov/Archives/edgar/data/${cik}/${src.adsh.replace(/-/g, "")}/${file}`,
					snippet: `${src.form ?? "Filing"} filed ${src.file_date ?? "unknown date"}, accession ${src.adsh}.`,
					publishedDate: src.file_date,
					record: { kind: "sec-filing", id: src.adsh, date: src.file_date, status: src.form },
				});
				if (out.length >= req.maxResults) break;
			}
			return out;
		},
	};
}

/** ClinicalTrials.gov API v2. No key. */
export function createClinicalTrialsProvider(fetchImpl: Fetch = globalThis.fetch): SearchProvider {
	return {
		name: "clinicaltrials",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({
				"query.term": req.query,
				pageSize: String(Math.min(req.maxResults, 20)),
				format: "json",
				fields: "NCTId,BriefTitle,OverallStatus,StartDate,LastUpdatePostDate,BriefSummary",
			});
			const data = await getJson<{ studies?: Array<{ protocolSection?: { identificationModule?: { nctId?: string; briefTitle?: string }; statusModule?: { overallStatus?: string; startDateStruct?: { date?: string }; lastUpdatePostDateStruct?: { date?: string } }; descriptionModule?: { briefSummary?: string } } }> }>(
				"ClinicalTrials.gov",
				fetchImpl,
				`https://clinicaltrials.gov/api/v2/studies?${params}`,
				{ headers: { Accept: "application/json" }, signal: req.signal },
			);
			const out: SearchResult[] = [];
			for (const study of data.studies ?? []) {
				const p = study.protocolSection;
				const id = p?.identificationModule?.nctId;
				if (!id) continue;
				const status = p?.statusModule?.overallStatus;
				const date = p?.statusModule?.lastUpdatePostDateStruct?.date;
				out.push({
					title: p?.identificationModule?.briefTitle ?? id,
					url: `https://clinicaltrials.gov/study/${id}`,
					snippet: `${id}, status ${status ?? "unknown"}, started ${p?.statusModule?.startDateStruct?.date ?? "unknown"}. ${trim(p?.descriptionModule?.briefSummary)}`,
					publishedDate: date,
					record: { kind: "clinical-trial", id, date, status },
				});
			}
			return out.slice(0, req.maxResults);
		},
	};
}

/** CourtListener opinion search. Needs COURTLISTENER_TOKEN. */
export function createCourtListenerProvider(fetchImpl: Fetch = globalThis.fetch): SearchProvider {
	return {
		name: "courtlistener",
		tier: "cloud",
		isConfigured: () => Boolean(process.env.COURTLISTENER_TOKEN),
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({ q: req.query, type: "o", page_size: String(Math.min(req.maxResults, 20)) });
			const data = await getJson<{ results?: Array<{ caseName?: string; absolute_url?: string; dateFiled?: string; court?: string; docketNumber?: string; status?: string; cluster_id?: number; opinions?: Array<{ snippet?: string }> }> }>(
				"CourtListener",
				fetchImpl,
				`https://www.courtlistener.com/api/rest/v4/search/?${params}`,
				{ headers: { Authorization: `Token ${process.env.COURTLISTENER_TOKEN}`, Accept: "application/json" }, signal: req.signal },
			);
			const out: SearchResult[] = [];
			for (const r of data.results ?? []) {
				if (!r.absolute_url || !r.caseName) continue;
				out.push({
					title: r.caseName,
					url: `https://www.courtlistener.com${r.absolute_url}`,
					snippet: `${r.court ?? "Court"}, docket ${r.docketNumber ?? "unknown"}, filed ${r.dateFiled ?? "unknown"}. ${trim(r.opinions?.[0]?.snippet)}`,
					publishedDate: r.dateFiled,
					record: { kind: "court-opinion", id: String(r.cluster_id ?? r.docketNumber ?? r.absolute_url), date: r.dateFiled, status: r.status },
				});
			}
			return out.slice(0, req.maxResults);
		},
	};
}

/** GitHub code search. Needs GITHUB_TOKEN; the endpoint refuses anonymous callers. */
export function createGithubCodeProvider(fetchImpl: Fetch = globalThis.fetch): SearchProvider {
	return {
		name: "github-code",
		tier: "cloud",
		isConfigured: () => Boolean(process.env.GITHUB_TOKEN),
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({ q: req.query, per_page: String(Math.min(req.maxResults, 30)) });
			const data = await getJson<{ items?: Array<{ name?: string; path?: string; html_url?: string; sha?: string; repository?: { full_name?: string } }> }>(
				"GitHub",
				fetchImpl,
				`https://api.github.com/search/code?${params}`,
				{ headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "PiDeepResearch/1.0" }, signal: req.signal },
			);
			const out: SearchResult[] = [];
			for (const item of data.items ?? []) {
				if (!item.html_url || !item.path) continue;
				out.push({
					title: `${item.repository?.full_name ?? "repository"}: ${item.path}`,
					url: item.html_url,
					snippet: `File ${item.path} in ${item.repository?.full_name ?? "unknown repository"}.`,
					record: { kind: "code-file", id: item.sha ?? item.html_url },
				});
			}
			return out.slice(0, req.maxResults);
		},
	};
}

/** GDELT DOC 2.0 news article search. No key; one request per 5 seconds, and a limit comes back as plain text. */
export function createGdeltProvider(fetchImpl: Fetch = globalThis.fetch): SearchProvider {
	return {
		name: "gdelt",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const params = new URLSearchParams({ query: req.query, mode: "artlist", format: "json", maxrecords: String(Math.min(req.maxResults, 50)), sort: "datedesc" });
			if (req.freshnessDays) params.set("timespan", `${req.freshnessDays}d`);
			const data = await getJson<{ articles?: Array<{ url?: string; title?: string; seendate?: string; domain?: string; language?: string; sourcecountry?: string }> }>(
				"GDELT",
				fetchImpl,
				`https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
				{ headers: { Accept: "application/json" }, signal: req.signal },
			);
			const out: SearchResult[] = [];
			for (const a of data.articles ?? []) {
				if (!a.url || !a.title) continue;
				const d = a.seendate && /^\d{8}T\d{6}Z$/.test(a.seendate) ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : undefined;
				out.push({
					title: a.title,
					url: a.url,
					snippet: `${a.domain ?? "unknown outlet"}${a.sourcecountry ? ` (${a.sourcecountry})` : ""}${a.language ? `, ${a.language}` : ""}, first seen ${d ?? "unknown"}.`,
					publishedDate: d,
					record: { kind: "news-article", id: a.url, date: d },
				});
			}
			return out.slice(0, req.maxResults);
		},
	};
}

/** PubMed through NCBI E-utilities, for MeSH terms and date sort beyond what Europe PMC offers. NCBI_API_KEY is optional. */
export function createPubmedProvider(fetchImpl: Fetch = globalThis.fetch): SearchProvider {
	const key = (): Record<string, string> => (process.env.NCBI_API_KEY ? { api_key: process.env.NCBI_API_KEY } : {});
	return {
		name: "pubmed",
		tier: "cloud",
		isConfigured: () => true,
		async search(req: SearchRequest): Promise<SearchResult[]> {
			const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
			const headers = { Accept: "application/json" };
			const found = await getJson<{ esearchresult?: { idlist?: string[] } }>(
				"PubMed",
				fetchImpl,
				`${base}/esearch.fcgi?${new URLSearchParams({ db: "pubmed", term: req.query, retmax: String(Math.min(req.maxResults, 20)), retmode: "json", sort: "relevance", ...(req.freshnessDays ? { reldate: String(req.freshnessDays), datetype: "pdat" } : ({} as Record<string, string>)), ...key() })}`,
				{ headers, signal: req.signal },
			);
			const ids = found.esearchresult?.idlist ?? [];
			if (!ids.length) return [];
			const sum = await getJson<{ result?: Record<string, { uid?: string; title?: string; source?: string; pubdate?: string; sortpubdate?: string; pubtype?: string[] }> }>(
				"PubMed",
				fetchImpl,
				`${base}/esummary.fcgi?${new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json", ...key() })}`,
				{ headers, signal: req.signal },
			);
			const out: SearchResult[] = [];
			for (const id of ids) {
				const d = sum.result?.[id];
				if (!d?.title) continue;
				const date = d.sortpubdate?.slice(0, 10).replace(/\//g, "-");
				out.push({
					title: d.title.replace(/\.$/, ""),
					url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
					snippet: `${d.source ?? "Journal"}, ${d.pubdate ?? "unknown date"}. ${(d.pubtype ?? []).join(", ")}`,
					publishedDate: date,
					record: { kind: "pubmed", id, date, status: d.pubtype?.[0] },
				});
			}
			return out;
		},
	};
}
