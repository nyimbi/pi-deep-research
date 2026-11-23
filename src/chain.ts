import type { SourceLedger } from "./ledger.ts";
import { refineResults } from "./dedupe.ts";
import { mergeResults, normalizeUrl } from "./normalize.ts";
import { HttpStatusError, type JsonCache, type ProviderBreaker, type UrlPolicy } from "./runtime.ts";
import { assertFetchableUrlResolved } from "./runtime.ts";
import { applyDomainFilter, extractWithFetch } from "./shared.ts";
import type { Attempt, ExtractResult, SearchProvider, SearchRequest, SearchResult } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;

export const NO_SEARCH_API_MESSAGE =
	"No search API configured. Set TAVILY_API_KEY or BRAVE_API_KEY environment variable.\n" +
	"  Tavily: https://tavily.com (free: 1000 req/month)\n" +
	"  Brave:  https://brave.com/search/api/ (free: 2000 req/month)\n" +
	"To use custom search providers, set SEARCH_PROVIDERS and drop a plugin into ~/.pi/agent/pi-deep-research/providers/ (see README → Custom Search Providers).";

export class ChainError extends Error {
	attempts: Attempt[];
	constructor(message: string, attempts: Attempt[]) {
		super(message);
		this.name = "ChainError";
		this.attempts = attempts;
	}
}

export function formatAttempts(attempts: Attempt[]): string {
	return attempts
		.map((a) => {
			if (a.status === "skipped") return `${a.provider} → skipped (${a.reason ?? "not configured"})`;
			if (a.status === "empty") return `${a.provider} → empty`;
			return `${a.provider} → error (${a.message ?? "unknown error"})`;
		})
		.join(", ");
}

/** Reject with a timeout error when the signal fires, even if the provider ignores it. */
function raceTimeout<T>(p: Promise<T>, signal: AbortSignal, ms: number): Promise<T> {
	return Promise.race([
		p,
		new Promise<never>((_, reject) => {
			const abort = () => reject(new Error(`timed out after ${ms}ms`));
			if (signal.aborted) return abort();
			signal.addEventListener("abort", abort, { once: true });
		}),
	]);
}

export interface ChainSearchOptions {
	maxResults: number;
	searchDepth?: "basic" | "advanced";
	freshnessDays?: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	timeoutMs?: number;
	/** Cache for results; omit to disable in tests and one-off calls. */
	cache?: JsonCache;
	/** Per-provider circuit breaker; omit to disable. */
	breaker?: ProviderBreaker;
	/** Records every result and failure for the research package. */
	ledger?: SourceLedger;
	/** Merge every configured provider instead of stopping at the first success. */
	merge?: boolean;
	/** Parallel calls for merge and batch modes. */
	concurrency?: number;
	/** Search cache lifetime; defaults to one hour. */
	searchTtlMs?: number;
}

export interface ChainSearchResult {
	provider: string;
	results: SearchResult[];
	attempts: Attempt[];
	cached?: boolean;
}

function searchKey(provider: string, query: string, opts: ChainSearchOptions): string[] {
	return [
		"search",
		provider,
		query,
		String(opts.maxResults),
		opts.searchDepth ?? "basic",
		String(opts.freshnessDays ?? ""),
		(opts.includeDomains ?? []).join(","),
		(opts.excludeDomains ?? []).join(","),
	];
}

/**
 * Uniform chain semantics — the same rule for every provider, no tier asymmetry:
 *   isConfigured() false → skipped · breaker open → skipped · cache hit → win ·
 *   ≥1 result after domain filtering → win · empty → continue · throw → continue ·
 *   exhausted → aggregated ChainError.
 */
async function searchProvider(
	provider: SearchProvider,
	query: string,
	opts: ChainSearchOptions,
	attempts: Attempt[],
): Promise<{ results: SearchResult[]; cached: boolean } | null> {
	if (!provider.isConfigured()) {
		attempts.push({ provider: provider.name, status: "skipped", reason: "not configured" });
		opts.ledger?.recordQuery(provider.name, query, "skipped", 0, false, "not configured");
		return null;
	}
	if (opts.breaker?.isOpen(provider.name)) {
		attempts.push({ provider: provider.name, status: "skipped", reason: "circuit open" });
		opts.ledger?.recordQuery(provider.name, query, "skipped", 0, false, "circuit open");
		return null;
	}
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const key = opts.cache?.key(...searchKey(provider.name, query, opts));
	if (key) {
		const cached = await opts.cache!.get<SearchResult[]>(key);
		if (cached) {
			opts.breaker?.recordSuccess(provider.name);
			return { results: cached.slice(0, opts.maxResults), cached: true };
		}
	}
	const signal = AbortSignal.timeout(timeoutMs);
	const request: SearchRequest = {
		query,
		maxResults: opts.maxResults,
		searchDepth: opts.searchDepth,
		freshnessDays: opts.freshnessDays,
		includeDomains: opts.includeDomains,
		excludeDomains: opts.excludeDomains,
		signal,
	};
	try {
		const raw = await raceTimeout(provider.search(request), signal, timeoutMs);
		const results = applyDomainFilter(raw, opts.includeDomains, opts.excludeDomains).slice(0, opts.maxResults);
		if (results.length > 0) {
			opts.breaker?.recordSuccess(provider.name);
			if (key) await opts.cache!.set(key, results, opts.searchTtlMs ?? 3_600_000);
			return { results, cached: false };
		}
		attempts.push({ provider: provider.name, status: "empty" });
		opts.ledger?.recordQuery(provider.name, query, "empty", 0);
	} catch (e) {
		opts.breaker?.recordFailure(provider.name);
		const message = e instanceof Error ? e.message : String(e);
		attempts.push({ provider: provider.name, status: "error", message });
		opts.ledger?.recordQuery(provider.name, query, "error", 0, false, message);
	}
	return null;
}

export async function chainSearch(
	chain: SearchProvider[],
	query: string,
	opts: ChainSearchOptions,
): Promise<ChainSearchResult> {
	const attempts: Attempt[] = [];
	for (const provider of chain) {
		const outcome = await searchProvider(provider, query, opts, attempts);
		if (outcome) {
			opts.ledger?.recordSearch(provider.name, query, outcome.results, outcome.cached);
			return { provider: provider.name, results: outcome.results, attempts, cached: outcome.cached };
		}
	}
	if (attempts.length > 0 && attempts.every((a) => a.status === "skipped")) {
		throw new ChainError(NO_SEARCH_API_MESSAGE, attempts);
	}
	throw new ChainError(
		`No search provider produced results for query "${query}". Attempts: ${formatAttempts(attempts)}`,
		attempts,
	);
}

/** Query every configured provider in parallel and merge by URL. */
export async function chainSearchAll(
	chain: SearchProvider[],
	query: string,
	opts: ChainSearchOptions,
): Promise<ChainSearchResult> {
	const outcomes = await Promise.all(
		chain.map(async (provider) => {
			const attempts: Attempt[] = [];
			const outcome = await searchProvider(provider, query, opts, attempts);
			if (outcome) opts.ledger?.recordSearch(provider.name, query, outcome.results, outcome.cached);
			return { provider: provider.name, outcome, attempts };
		}),
	);
	const attempts = outcomes.flatMap((entry) => entry.attempts);
	const groups = outcomes
		.filter((entry) => entry.outcome !== null)
		.map((entry) => ({ provider: entry.provider, results: entry.outcome!.results }));
	if (groups.length === 0) {
		if (attempts.length > 0 && attempts.every((a) => a.status === "skipped")) {
			throw new ChainError(NO_SEARCH_API_MESSAGE, attempts);
		}
		throw new ChainError(
			`No search provider produced results for query "${query}". Attempts: ${formatAttempts(attempts)}`,
			attempts,
		);
	}
	return { provider: "merged", results: mergeResults(groups, opts.maxResults), attempts };
}

export interface ChainExtractOptions {
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	cache?: JsonCache;
	cacheTtlMs?: number;
	breaker?: ProviderBreaker;
	ledger?: SourceLedger;
	safety?: UrlPolicy;
}

/**
 * Walk the chain in order; the first configured provider that has extract()
 * handles the URL. Blank/empty content counts as failure → continue. If no
 * provider is capable, fall back to the basic HTTP fetch extractor.
 */
export async function chainExtract(
	chain: SearchProvider[],
	url: string,
	opts: ChainExtractOptions = {},
): Promise<ExtractResult> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (opts.safety) await assertFetchableUrlResolved(url, opts.safety);
	const cacheKey = opts.cache?.key("extract", normalizeUrl(url));
	if (cacheKey) {
		const cached = await opts.cache!.get<ExtractResult>(cacheKey);
		if (cached) {
			opts.ledger?.recordExtract(url, cached, true);
			return cached;
		}
	}

	for (const provider of chain) {
		if (!provider.isConfigured() || typeof provider.extract !== "function") continue;
		if (opts.breaker?.isOpen(provider.name)) continue;
		const signal = AbortSignal.timeout(timeoutMs);
		try {
			const raw = await raceTimeout(Promise.resolve(provider.extract(url, signal)), signal, timeoutMs);
			if (!raw?.content?.trim()) {
				console.warn(`[pi-deep-research] ${provider.name} extract returned no content for ${url}`);
				continue;
			}
			const result: ExtractResult = { ...raw, provider: provider.name };
			opts.breaker?.recordSuccess(provider.name);
			if (cacheKey) await opts.cache!.set(cacheKey, result, opts.cacheTtlMs ?? 604_800_000);
			opts.ledger?.recordExtract(url, result);
			return result;
		} catch (e) {
			opts.breaker?.recordFailure(provider.name);
			const message = e instanceof Error ? e.message : String(e);
			opts.ledger?.recordFailure(provider.name, "extract", message);
			console.warn(`[pi-deep-research] ${provider.name} extract failed: ${message}`);
		}
	}

	let result: ExtractResult;
	try {
		result = await extractWithFetch(url, opts.fetchImpl, { policy: opts.safety });
	} catch (error) {
		if (error instanceof HttpStatusError && error.status === 402) opts.ledger?.recordUrlStatus(url, "payment_required", "HTTP 402");
		throw error;
	}
	opts.ledger?.recordExtract(url, result);
	if (cacheKey) await opts.cache!.set(cacheKey, result, opts.cacheTtlMs ?? 604_800_000);
	return result;
}

export interface BatchOutcome {
	results: Record<string, SearchResult[]>;
	providers: string[];
	failures: Record<string, string>;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

/** Run the chain per query with bounded parallelism; failures are surfaced per query. */
export async function chainBatchSearch(
	chain: SearchProvider[],
	queries: string[],
	opts: ChainSearchOptions,
): Promise<BatchOutcome> {
	const settled = await mapWithConcurrency(queries, opts.concurrency ?? 3, async (query) => {
		try {
			return (opts.merge ? await chainSearchAll(chain, query, opts) : await chainSearch(chain, query, opts));
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error));
		}
	});
	const used = new Set<string>();
	const results: Record<string, SearchResult[]> = {};
	const failures: Record<string, string> = {};
	settled.forEach((outcome, index) => {
		const query = queries[index];
		if (outcome instanceof Error) {
			results[query] = [];
			failures[query] = outcome.message;
		} else {
			used.add(outcome.provider);
			results[query] = refineResults(outcome.results, { maxResults: opts.maxResults, freshnessDays: opts.freshnessDays });
		}
	});
	return { results, providers: [...used], failures };
}
