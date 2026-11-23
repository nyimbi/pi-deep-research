#!/usr/bin/env node
// Usage: node scripts/entailment-eval.ts model [model ...]. Agreement of the local judge with hand labels.
import { readFile } from "node:fs/promises";
import { judgeClaim } from "../src/entailment.ts";
import { createOllamaLlm } from "../src/llm.ts";

const fixture = JSON.parse(await readFile(new URL("../test/fixtures/entailment/basic.json", import.meta.url), "utf8")) as Array<{ claim: string; passage: string; supported: boolean }>;
const base = `http://${process.env.OLLAMA_HOST ?? "127.0.0.1"}:${process.env.OLLAMA_PORT ?? "11434"}`;
for (const model of process.argv.slice(2)) {
	const llm = createOllamaLlm({ baseUrl: base, model, timeoutMs: 180_000 });
	let agree = 0;
	let errors = 0;
	let falseSupport = 0;
	const started = Date.now();
	for (const item of fixture) {
		const verdict = await judgeClaim(llm, item.claim, [item.passage]);
		if (verdict === "error") errors += 1;
		else if ((verdict === "supported") === item.supported) agree += 1;
		else if (verdict === "supported") falseSupport += 1;
	}
	console.log(`${model.padEnd(18)} agreement ${agree}/${fixture.length} (${(agree / fixture.length).toFixed(2)})  false-support ${falseSupport}  errors ${errors}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
