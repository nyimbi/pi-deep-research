/** URL identity, source tiers, domain policy, and multi-provider merging. */
import type { SearchResult } from "./types.ts";

const TRACKING = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|igshid$|ref_src$|ref_url$|spm$)/i;

export function normalizeUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		return raw.trim();
	}
	parsed.hash = "";
	parsed.hostname = parsed.hostname.toLowerCase();
	if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
		parsed.port = "";
	}
	const kept = [...parsed.searchParams.entries()]
		.filter(([key]) => !TRACKING.test(key))
		.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
	parsed.search = "";
	for (const [key, value] of kept) parsed.searchParams.append(key, value);
	if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
	return parsed.toString();
}

export function hostOf(raw: string): string {
	try {
		return new URL(raw).hostname.toLowerCase();
	} catch {
		return "";
	}
}

export function classifyTier(raw: string): number {
	const host = hostOf(raw);
	if (!host) return 4;
	if (host.endsWith(".gov") || host.endsWith(".mil") || host.endsWith(".edu") || host.endsWith(".int")) return 1;
	if (["arxiv.org", "acm.org", "ieee.org", "nature.com", "science.org", "iso.org", "ietf.org", "w3.org"].some((d) => host === d || host.endsWith(`.${d}`))) return 1;
	if (["docs.python.org", "developer.mozilla.org", "github.com", "docs.github.com", "learn.microsoft.com", "cloud.google.com", "aws.amazon.com"].some((d) => host === d || host.endsWith(`.${d}`))) return 1;
	if (["reuters.com", "apnews.com", "bbc.co.uk", "bbc.com", "ft.com", "wsj.com", "infoq.com", "arstechnica.com", "theverge.com"].some((d) => host === d || host.endsWith(`.${d}`))) return 2;
	if (["stackoverflow.com", "reddit.com", "news.ycombinator.com", "medium.com", "dev.to", "x.com", "twitter.com"].some((d) => host === d || host.endsWith(`.${d}`))) return 3;
	return 4;
}

export function domainMatches(host: string, domain: string): boolean {
	const cleaned = domain.toLowerCase().replace(/^\.+/, "");
	return host === cleaned || host.endsWith(`.${cleaned}`);
}

export function domainAllowed(host: string, allowed: string[] = [], blocked: string[] = []): boolean {
	if (blocked.some((domain) => domainMatches(host, domain))) return false;
	if (allowed.length === 0) return true;
	return allowed.some((domain) => domainMatches(host, domain));
}

export function extractUrls(markdown: string): string[] {
	const found = new Set<string>();
	const re = /https?:\/\/[^\s<>"')\]]+/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(markdown)) !== null) {
		const value = match[0].replace(/[.,;:]+$/, "");
		if (value) found.add(value);
	}
	return [...found];
}

/** Reciprocal-rank fusion by normalized URL, preserving provider order as a tiebreak. */
export function mergeResults(
	groups: Array<{ provider: string; results: SearchResult[] }>,
	maxResults: number,
): SearchResult[] {
	const scored = new Map<string, { result: SearchResult; score: number; providers: Set<string>; bestRank: number; order: number }>();
	let order = 0;
	for (const group of groups) {
		group.results.forEach((result, rank) => {
			const key = normalizeUrl(result.url);
			if (!key) return;
			const existing = scored.get(key);
			const contribution = 1 / (60 + rank + 1);
			if (existing) {
				existing.score += contribution;
				existing.providers.add(group.provider);
				existing.bestRank = Math.min(existing.bestRank, rank);
				if (!existing.result.snippet && result.snippet) existing.result.snippet = result.snippet;
				return;
			}
			scored.set(key, {
				result: { ...result, url: key },
				score: contribution,
				providers: new Set([group.provider]),
				bestRank: rank,
				order: order++,
			});
		});
	}
	return [...scored.values()]
		.sort((a, b) => b.providers.size - a.providers.size || b.score - a.score || a.bestRank - b.bestRank || a.order - b.order)
		.slice(0, maxResults)
		.map((entry) => entry.result);
}
