/** Hybrid passage retrieval: BM25 and dense similarity fused with reciprocal rank fusion. */
import type { Chunk } from "./chunks.ts";
import { cosine, type Embedder } from "./embed.ts";

const TOKEN = /[\p{L}\p{N}]{2,}/gu;
const tokens = (text: string): string[] => text.toLowerCase().match(TOKEN) ?? [];

/** Chunk indices ranked by BM25 (k1 1.2, b 0.75), best first; zero-score chunks dropped. */
export function bm25Order(chunks: Chunk[], query: string): number[] {
	const terms = [...new Set(tokens(query))];
	if (!terms.length || !chunks.length) return [];
	const docs = chunks.map((chunk) => tokens(chunk.text));
	const avg = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
	const df = new Map<string, number>();
	const tfs = docs.map((doc) => {
		const map = new Map<string, number>();
		for (const t of doc) map.set(t, (map.get(t) ?? 0) + 1);
		for (const t of map.keys()) df.set(t, (df.get(t) ?? 0) + 1);
		return map;
	});
	const n = chunks.length;
	return docs
		.map((doc, i) => {
			let score = 0;
			for (const term of terms) {
				const tf = tfs[i].get(term) ?? 0;
				if (!tf) continue;
				const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
				score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / avg));
			}
			return { i, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map((entry) => entry.i);
}

/** Reciprocal rank fusion over ranked id lists. */
export function rrf(lists: number[][], k = 60): number[] {
	const score = new Map<number, number>();
	for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
	return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
}

export interface RankResult {
	order: number[];
	mode: "hybrid" | "lexical";
	note?: string;
}

/** Full ranking of chunk indices for `query`. Falls back to BM25 alone when the embedder is absent or fails. */
export async function rankPassages(chunks: Chunk[], query: string, embedder: Embedder | null, options: { queryPrefix?: string } = {}): Promise<RankResult> {
	const lexical = bm25Order(chunks, query);
	if (!embedder || !chunks.length || !query.trim()) return { order: lexical, mode: "lexical" };
	try {
		const [q, ...docs] = await embedder.embed([(options.queryPrefix ?? "") + query, ...chunks.map((chunk) => chunk.text)]);
		const dense = docs.map((vector, i) => ({ i, score: cosine(q, vector) })).sort((a, b) => b.score - a.score || a.i - b.i).map((entry) => entry.i);
		return { order: rrf([lexical, dense]), mode: "hybrid" };
	} catch (error) {
		return { order: lexical, mode: "lexical", note: `embeddings unavailable: ${error instanceof Error ? error.message : String(error)}` };
	}
}
