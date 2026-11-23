/** Post-merge hygiene for search results: freshness filter, near-duplicate removal, MMR diversity. */
import { createHash } from "node:crypto";
import type { SearchResult } from "./types.ts";

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** 64-bit simhash over word trigrams (unigrams for very short text). */
export function simhash(text: string): bigint {
	const w = words(text);
	const grams = w.length >= 3 ? w.slice(0, w.length - 2).map((_, i) => w.slice(i, i + 3).join(" ")) : w;
	const votes = new Array<number>(64).fill(0);
	for (const gram of grams) {
		const h = createHash("sha1").update(gram).digest().readBigUInt64BE(0);
		for (let bit = 0; bit < 64; bit++) votes[bit] += (h >> BigInt(bit)) & 1n ? 1 : -1;
	}
	let out = 0n;
	for (let bit = 0; bit < 64; bit++) if (votes[bit] > 0) out |= 1n << BigInt(bit);
	return out;
}

export function hamming(a: bigint, b: bigint): number {
	let x = a ^ b;
	let n = 0;
	while (x) {
		n += Number(x & 1n);
		x >>= 1n;
	}
	return n;
}

/** Drop results whose title and snippet are within `maxDistance` bits of an earlier, higher-ranked result. */
export function dropNearDuplicates(results: SearchResult[], maxDistance = 12): SearchResult[] {
	const kept: Array<{ result: SearchResult; hash: bigint }> = [];
	for (const result of results) {
		const text = `${result.title} ${result.snippet}`;
		if (words(text).length < 6) {
			kept.push({ result, hash: -1n });
			continue;
		}
		const hash = simhash(text);
		if (!kept.some((k) => k.hash >= 0n && hamming(k.hash, hash) <= maxDistance)) kept.push({ result, hash });
	}
	return kept.map((k) => k.result);
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	return a.size + b.size - inter === 0 ? 0 : inter / (a.size + b.size - inter);
};

/** Maximal marginal relevance: relevance is rank-based, similarity is Jaccard over title and snippet words. */
export function mmrSelect(results: SearchResult[], k: number, lambda = 0.5): SearchResult[] {
	const sets = results.map((r) => new Set(words(`${r.title} ${r.snippet}`)));
	const relevance = results.map((_, i) => 1 - i / Math.max(1, results.length));
	const chosen: number[] = [];
	const rest = new Set(results.map((_, i) => i));
	while (chosen.length < Math.min(k, results.length)) {
		let best = -1;
		let bestScore = -Infinity;
		for (const i of rest) {
			const sim = chosen.length ? Math.max(...chosen.map((j) => jaccard(sets[i], sets[j]))) : 0;
			const score = lambda * relevance[i] - (1 - lambda) * sim;
			if (score > bestScore) {
				bestScore = score;
				best = i;
			}
		}
		chosen.push(best);
		rest.delete(best);
	}
	return chosen.map((i) => results[i]);
}

/** Exclude results with a parseable publishedDate older than `days`. Undated results are kept. */
export function filterFresh(results: SearchResult[], days: number | undefined, now = Date.now()): SearchResult[] {
	if (!days || days <= 0) return results;
	const cutoff = now - days * 86_400_000;
	return results.filter((r) => {
		const t = r.publishedDate ? Date.parse(r.publishedDate) : Number.NaN;
		return Number.isNaN(t) || t >= cutoff;
	});
}

export function refineResults(results: SearchResult[], options: { maxResults: number; freshnessDays?: number; now?: number }): SearchResult[] {
	return mmrSelect(dropNearDuplicates(filterFresh(results, options.freshnessDays, options.now)), options.maxResults);
}
