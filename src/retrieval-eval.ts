/** Retrieval eval: hit rate at k over labelled (page, question, gold substring) triples. */
import { chunkText, rankChunks, type Chunk } from "./chunks.ts";
import type { Embedder } from "./embed.ts";
import { bm25Order, rankPassages } from "./retrieval.ts";

export interface EvalFixture {
	pages: Array<{ id: string; text: string }>;
	questions: Array<{ page: string; query: string; gold: string }>;
}

export type Ranker = (chunks: Chunk[], query: string) => Promise<number[]>;

export const KS = [1, 3, 5] as const;

export function rankers(embedder: Embedder | null): Record<string, Ranker> {
	const out: Record<string, Ranker> = {
		tfidf: async (chunks, query) => rankChunks(chunks, query, chunks.length).map((c) => chunks.indexOf(c)),
		bm25: async (chunks, query) => bm25Order(chunks, query),
	};
	if (embedder) out.hybrid = async (chunks, query) => (await rankPassages(chunks, query, embedder)).order;
	return out;
}

/** Fraction of questions whose gold substring sits in one of the top-k chunks. */
export async function evaluate(fixture: EvalFixture, rank: Ranker, chunkWords = 60): Promise<Record<number, number>> {
	const pages = new Map(fixture.pages.map((p) => [p.id, chunkText(p.text, chunkWords)]));
	const hits: Record<number, number> = Object.fromEntries(KS.map((k) => [k, 0]));
	for (const q of fixture.questions) {
		const chunks = pages.get(q.page);
		if (!chunks) throw new Error(`fixture question names unknown page ${q.page}`);
		if (!chunks.some((c) => c.text.includes(q.gold))) throw new Error(`gold "${q.gold}" is not in page ${q.page}`);
		const order = await rank(chunks, q.query);
		for (const k of KS) if (order.slice(0, k).some((i) => chunks[i].text.includes(q.gold))) hits[k] += 1;
	}
	for (const k of KS) hits[k] = hits[k] / fixture.questions.length;
	return hits;
}
