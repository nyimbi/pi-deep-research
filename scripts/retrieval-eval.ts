#!/usr/bin/env node
// Usage: node scripts/retrieval-eval.ts [fixture.json ...]. Hybrid runs only when Ollama answers.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOllamaEmbedder } from "../src/embed.ts";
import { evaluate, KS, rankers, type EvalFixture } from "../src/retrieval-eval.ts";

const files = process.argv.slice(2);
if (!files.length) files.push(new URL("../test/fixtures/retrieval/basic.json", import.meta.url).pathname);
const embedder = createOllamaEmbedder({
	baseUrl: `http://${process.env.OLLAMA_HOST ?? "127.0.0.1"}:${process.env.OLLAMA_PORT ?? "11434"}`,
	model: process.env.EMBEDDINGS_MODEL ?? "embeddinggemma",
	cacheDir: join(homedir(), ".pi", "agent", "pi-deep-research", "cache"),
	timeoutMs: 20_000,
});
let live = true;
await embedder.embed(["ping"]).catch((error) => {
	live = false;
	console.error(`hybrid skipped: ${error instanceof Error ? error.message : error}`);
});
for (const file of files) {
	const fixture = JSON.parse(await readFile(file, "utf8")) as EvalFixture;
	console.log(`${file} (${fixture.questions.length} questions)`);
	for (const [name, rank] of Object.entries(rankers(live ? embedder : null))) {
		const hits = await evaluate(fixture, rank, Number(process.env.CHUNK_WORDS ?? 60));
		console.log(`  ${name.padEnd(7)} ${KS.map((k) => `hit@${k} ${hits[k].toFixed(2)}`).join("  ")}`);
	}
}
