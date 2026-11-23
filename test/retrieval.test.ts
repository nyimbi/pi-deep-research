import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chunkText } from "../src/chunks.ts";
import { createOllamaEmbedder, type Embedder } from "../src/embed.ts";
import { bm25Order, rankPassages, rrf } from "../src/retrieval.ts";

/** A real HTTP-shaped fake of Ollama /api/embed: bag of three concept axes. */
function fakeOllama(calls: string[][]): typeof fetch {
	const axes = [/car|auto|vehicle/i, /fruit|apple|pear/i, /tax|levy|duty/i];
	return (async (_url: unknown, init: { body: string }) => {
		const { input } = JSON.parse(init.body) as { input: string[] };
		calls.push(input);
		return new Response(JSON.stringify({ embeddings: input.map((t) => axes.map((a) => (a.test(t) ? 1 : 0.01))) }));
	}) as unknown as typeof fetch;
}

describe("embedder cache", () => {
	it("serves an unchanged text from disk and only requests new ones", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-emb-"));
		try {
			const calls: string[][] = [];
			const e = createOllamaEmbedder({ baseUrl: "http://x", model: "m", cacheDir: dir, fetchImpl: fakeOllama(calls) });
			await e.embed(["a car", "an apple"]);
			assert.deepEqual(e.stats(), { hits: 0, misses: 2 });
			const again = await e.embed(["a car", "a tax"]);
			assert.deepEqual(calls[1], ["a tax"]);
			assert.deepEqual(e.stats(), { hits: 1, misses: 3 });
			assert.equal(again.length, 2);
			const fresh = createOllamaEmbedder({ baseUrl: "http://x", model: "m", cacheDir: dir, fetchImpl: fakeOllama([]) });
			await fresh.embed(["a car"]);
			assert.deepEqual(fresh.stats(), { hits: 1, misses: 0 });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fusion", () => {
	it("rrf rewards agreement between lists", () => {
		assert.deepEqual(rrf([[1, 2, 3], [3, 2, 9]]).slice(0, 2), [3, 2]);
	});
	it("bm25 drops non-matching chunks and ranks the denser match first", () => {
		const chunks = chunkText("alpha beta\n\nbeta beta gamma\n\nnothing here", 3);
		assert.deepEqual(bm25Order(chunks, "beta"), [1, 0]);
	});
});

describe("rankPassages", () => {
	const text = "Quarterly vehicle registrations rose.\n\nThe apple harvest was poor.\n\nNew duty rates apply from May.";
	const chunks = chunkText(text, 5);

	it("finds a paraphrase that shares no word with the query, which BM25 misses", async () => {
		const e = createOllamaEmbedder({ baseUrl: "http://x", model: "m", cacheDir: await mkdtemp(join(tmpdir(), "pi-emb-")), fetchImpl: fakeOllama([]) });
		assert.deepEqual(bm25Order(chunks, "car sales"), []);
		const r = await rankPassages(chunks, "car sales", e);
		assert.equal(r.mode, "hybrid");
		assert.equal(chunks[r.order[0]].text.includes("vehicle"), true);
	});

	it("falls back to BM25 with a note when the embedder fails", async () => {
		const broken: Embedder = { model: "m", embed: async () => { throw new Error("connect refused"); }, stats: () => ({ hits: 0, misses: 0 }) };
		const r = await rankPassages(chunks, "apple", broken);
		assert.equal(r.mode, "lexical");
		assert.match(r.note ?? "", /connect refused/);
		assert.equal(chunks[r.order[0]].text.includes("apple"), true);
	});
});

import { readFile } from "node:fs/promises";
import { evaluate, rankers, type EvalFixture } from "../src/retrieval-eval.ts";

describe("retrieval eval harness", () => {
	it("scores the fixture, refuses a gold string that is not in the page, and can score a bad ranker 0", async () => {
		const fixture = JSON.parse(await readFile(new URL("./fixtures/retrieval/basic.json", import.meta.url), "utf8")) as EvalFixture;
		const lexical = rankers(null);
		assert.deepEqual(Object.keys(lexical), ["tfidf", "bm25"]);
		const hits = await evaluate(fixture, lexical.bm25);
		assert.ok(hits[1] <= hits[3] && hits[3] <= hits[5] && hits[5] > 0.5);
		await assert.rejects(evaluate({ ...fixture, questions: [{ ...fixture.questions[0], gold: "not on the page" }] }, lexical.bm25), /not in page/);
		const never = await evaluate({ ...fixture, questions: fixture.questions.slice(0, 1) }, async () => []);
		assert.equal(never[5], 0);
	});
});
