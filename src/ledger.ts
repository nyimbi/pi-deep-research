/** The evidence ledger for one research run. */
import { createHash } from "node:crypto";
import { classifyTier, extractUrls, normalizeUrl } from "./normalize.ts";
import type { RawCapture } from "./raw-store.ts";
import type { ExtractResult, SearchResult } from "./types.ts";

export interface LedgerSource {
	url: string;
	normalizedUrl: string;
	title: string;
	snippet: string;
	tier: number;
	providers: string[];
	queries: string[];
	firstSeen: string;
	lastSeen: string;
	extracted?: {
		title: string;
		content: string;
		wordCount: number;
		provider: string;
		fetchedAt: string;
		digest: string;
	};
	raw?: RawCapture;
}

/** Terminal fetch outcomes. A URL with one of the blocking statuses is never fetched again. */
export type UrlStatus = "payment_required" | "robots_blocked" | "archived" | "duplicate";

export const BLOCKING_STATUSES: readonly UrlStatus[] = ["payment_required", "robots_blocked"];

export interface UrlStatusRecord {
	status: UrlStatus;
	detail: string;
	at: string;
}

export interface QueryLogEntry {
	provider: string;
	query: string;
	status: "ok" | "empty" | "error" | "skipped";
	results: number;
	cached: boolean;
	at: string;
	message?: string;
}

export interface LedgerFailure {
	provider: string;
	stage: "search" | "extract";
	message: string;
	at: string;
}

export interface LedgerStats {
	sources: number;
	extracted: number;
	pages: number;
	cited: number;
	uncited: number;
	unknownCitations: number;
	searches: number;
	extracts: number;
	queryCalls: number;
	uniqueQueries: number;
	cacheHits: number;
	/** known / (known + unknown) citations in the report; null without a report or citations. */
	citationReturnRate: number | null;
	urlStatuses: Record<string, number>;
	llmCalls: number;
	llmFailures: number;
	providers: Record<string, number>;
	tiers: Record<string, number>;
	domains: Record<string, number>;
}

function now(): string {
	return new Date().toISOString();
}

function digest(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export class SourceLedger {
	private readonly sources = new Map<string, LedgerSource>();
	private readonly failures: LedgerFailure[] = [];
	private searches = 0;
	private extracts = 0;
	private cacheHits = 0;
	private llmCalls = 0;
	private llmFailures = 0;
	private readonly urlStatuses = new Map<string, UrlStatusRecord>();
	private readonly providerCalls: Record<string, number> = {};
	private readonly queryLog: QueryLogEntry[] = [];

	recordQuery(
		provider: string,
		query: string,
		status: QueryLogEntry["status"],
		results: number,
		cached = false,
		message?: string,
	): void {
		this.queryLog.push({ provider, query, status, results, cached, at: now(), ...(message ? { message } : {}) });
	}

	queryLogEntries(): QueryLogEntry[] {
		return [...this.queryLog];
	}

	recordSearch(provider: string, query: string, results: SearchResult[], cached = false): void {
		this.searches += 1;
		this.recordQuery(provider, query, "ok", results.length, cached);
		this.providerCalls[provider] = (this.providerCalls[provider] ?? 0) + 1;
		if (cached) this.cacheHits += 1;
		for (const result of results) {
			if (!result.url) continue;
			const key = normalizeUrl(result.url);
			const existing = this.sources.get(key);
			if (existing) {
				existing.lastSeen = now();
				if (!existing.providers.includes(provider)) existing.providers.push(provider);
				if (!existing.queries.includes(query)) existing.queries.push(query);
				if (!existing.snippet && result.snippet) existing.snippet = result.snippet;
				if (!existing.title && result.title) existing.title = result.title;
				continue;
			}
			this.sources.set(key, {
				url: result.url,
				normalizedUrl: key,
				title: result.title || key,
				snippet: result.snippet || "",
				tier: classifyTier(result.url),
				providers: [provider],
				queries: [query],
				firstSeen: now(),
				lastSeen: now(),
			});
		}
	}

	recordExtract(url: string, result: ExtractResult, cached = false): void {
		this.extracts += 1;
		this.providerCalls[result.provider] = (this.providerCalls[result.provider] ?? 0) + 1;
		if (cached) this.cacheHits += 1;
		const key = normalizeUrl(url);
		const existing = this.sources.get(key);
		const extracted = {
			title: result.title,
			content: result.content,
			wordCount: result.wordCount,
			provider: result.provider,
			fetchedAt: now(),
			digest: digest(result.content),
		};
		if (existing) {
			existing.extracted = extracted;
			existing.lastSeen = now();
			if (!existing.title) existing.title = result.title;
			return;
		}
		this.sources.set(key, {
			url,
			normalizedUrl: key,
			title: result.title || key,
			snippet: "",
			tier: classifyTier(url),
			providers: [result.provider],
			queries: [],
			firstSeen: now(),
			lastSeen: now(),
			extracted,
		});
	}

	recordLlmCall(ok: boolean): void {
		this.llmCalls += 1;
		if (!ok) this.llmFailures += 1;
	}

	recordUrlStatus(url: string, status: UrlStatus, detail = ""): void {
		this.urlStatuses.set(normalizeUrl(url), { status, detail: detail.slice(0, 200), at: now() });
	}

	urlStatus(url: string): UrlStatusRecord | undefined {
		return this.urlStatuses.get(normalizeUrl(url));
	}

	/** The reason a URL must not be fetched again, or null. */
	blockedReason(url: string): string | null {
		const record = this.urlStatus(url);
		return record && BLOCKING_STATUSES.includes(record.status) ? `${record.status}${record.detail ? `: ${record.detail}` : ""}` : null;
	}

	attachRaw(url: string, raw: RawCapture): void {
		const key = normalizeUrl(url);
		const existing = this.sources.get(key);
		if (existing) existing.raw = raw;
	}

	recordFailure(provider: string, stage: "search" | "extract", message: string): void {
		this.failures.push({ provider, stage, message: message.slice(0, 500), at: now() });
	}

	source(url: string): LedgerSource | undefined {
		return this.sources.get(normalizeUrl(url));
	}

	all(): LedgerSource[] {
		return [...this.sources.values()].sort((a, b) => a.tier - b.tier || a.title.localeCompare(b.title));
	}

	failureLog(): LedgerFailure[] {
		return [...this.failures];
	}

	citations(report: string): { known: string[]; unknown: string[] } {
		const known: string[] = [];
		const unknown: string[] = [];
		for (const raw of extractUrls(report)) {
			const key = normalizeUrl(raw);
			if (this.sources.has(key)) known.push(this.sources.get(key)!.url);
			else unknown.push(raw);
		}
		return { known: [...new Set(known)], unknown: [...new Set(unknown)] };
	}

	stats(report?: string): LedgerStats {
		const tiers: Record<string, number> = {};
		const domains: Record<string, number> = {};
		for (const source of this.sources.values()) {
			tiers[`tier${source.tier}`] = (tiers[`tier${source.tier}`] ?? 0) + 1;
			const host = source.normalizedUrl.split("/")[2] ?? "unknown";
			domains[host] = (domains[host] ?? 0) + 1;
		}
		const cited = report ? this.citations(report).known.length : 0;
		const uniqueQueries = new Set(this.queryLog.map((entry) => entry.query)).size;
		const unknowns = report ? this.citations(report).unknown.length : 0;
		const statuses: Record<string, number> = {};
		for (const record of this.urlStatuses.values()) statuses[record.status] = (statuses[record.status] ?? 0) + 1;
		return {
			sources: this.sources.size,
			extracted: [...this.sources.values()].filter((source) => source.extracted).length,
			pages: [...this.sources.values()].filter((source) => source.raw).length,
			cited,
			uncited: report ? Math.max(0, this.sources.size - cited) : 0,
			unknownCitations: unknowns,
			searches: this.searches,
			extracts: this.extracts,
			queryCalls: this.queryLog.length,
			uniqueQueries,
			cacheHits: this.cacheHits,
			citationReturnRate: report && cited + unknowns > 0 ? cited / (cited + unknowns) : null,
			urlStatuses: statuses,
			llmCalls: this.llmCalls,
			llmFailures: this.llmFailures,
			providers: { ...this.providerCalls },
			tiers,
			domains,
		};
	}

	budgetExceeded(maxSearches: number, maxExtracts: number): string | null {
		if (this.searches >= maxSearches) return `search budget exhausted (${this.searches}/${maxSearches})`;
		if (this.extracts >= maxExtracts) return `extract budget exhausted (${this.extracts}/${maxExtracts})`;
		return null;
	}

	persist(): Record<string, unknown> {
		return {
			type: "pi-deep-research-ledger-v1",
			generatedAt: now(),
			stats: this.stats(),
			sources: this.all(),
			queries: this.queryLogEntries(),
			failures: this.failureLog(),
			urlStatuses: Object.fromEntries(this.urlStatuses),
		};
	}
}
