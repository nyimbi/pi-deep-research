import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText, headWords, rankChunks } from "../src/chunks.ts";

const doc = [
	"Intro paragraph about cats and dogs.",
	"Photosynthesis converts light into chemical energy in chloroplasts.",
	"Tax law changed in 2024 for cross border trusts.",
	"Chloroplasts contain chlorophyll which absorbs light for photosynthesis.",
].join("\n\n");

describe("chunks", () => {
	it("headWords cuts at a word boundary and reports truncation", () => {
		assert.deepEqual(headWords("a b c d", 2), { text: "a b", truncated: true });
		assert.deepEqual(headWords("a b", 2), { text: "a b", truncated: false });
	});

	it("chunkText keeps paragraphs whole and splits an oversized one", () => {
		const chunks = chunkText(doc, 10);
		assert.ok(chunks.length >= 3);
		assert.equal(chunks.map((c) => c.index).join(), chunks.map((_, i) => i).join());
		const long = chunkText(Array.from({ length: 25 }, (_, i) => `w${i}`).join(" "), 10);
		assert.deepEqual(long.map((c) => c.words), [10, 10, 5]);
	});

	it("rankChunks returns matching passages in document order, and nothing for a miss", () => {
		const chunks = chunkText(doc, 10);
		const hits = rankChunks(chunks, "photosynthesis chloroplasts", 2);
		assert.equal(hits.length, 2);
		assert.ok(hits[0].index < hits[1].index);
		assert.ok(hits.every((h) => /photosynthesis/i.test(h.text)));
		assert.deepEqual(rankChunks(chunks, "zebra", 3), []);
		assert.deepEqual(rankChunks(chunks, "a", 3), []);
	});

	it("rarer terms outrank common ones", () => {
		const chunks = chunkText("the the the the cat\n\nthe the dog zebra", 5);
		assert.equal(rankChunks(chunks, "the zebra", 1)[0].index, 1);
	});
});
