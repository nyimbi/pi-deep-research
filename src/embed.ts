/** Local embeddings over Ollama /api/embed with an on-disk cache keyed by model and content hash. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EmbedderOptions {
	baseUrl: string;
	model: string;
	cacheDir: string;
	fetchImpl?: typeof fetch;
	batchSize?: number;
	timeoutMs?: number;
}

export interface Embedder {
	readonly model: string;
	embed(texts: string[]): Promise<number[][]>;
	stats(): { hits: number; misses: number };
}

function normalize(vector: number[]): number[] {
	const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
	return vector.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}

export function createOllamaEmbedder(options: EmbedderOptions): Embedder {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const batchSize = options.batchSize ?? 32;
	const dir = join(options.cacheDir, "embeddings", options.model.replace(/[^\w.-]+/g, "_"));
	let hits = 0;
	let misses = 0;
	const path = (text: string) => join(dir, `${createHash("sha256").update(text).digest("hex")}.json`);

	async function remote(batch: string[]): Promise<number[][]> {
		const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: options.model, input: batch }),
			signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
		});
		if (!response.ok) throw new Error(`embed ${response.status}: ${(await response.text().catch(() => "")).slice(0, 160)}`);
		const data = (await response.json()) as { embeddings?: number[][] };
		if (!data.embeddings || data.embeddings.length !== batch.length) throw new Error("embed: response did not match request");
		return data.embeddings.map(normalize);
	}

	return {
		model: options.model,
		stats: () => ({ hits, misses }),
		async embed(texts) {
			const out: Array<number[] | undefined> = await Promise.all(
				texts.map(async (text) => {
					try {
						return JSON.parse(await readFile(path(text), "utf8")) as number[];
					} catch {
						return undefined;
					}
				}),
			);
			const missing = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
			hits += texts.length - missing.length;
			misses += missing.length;
			for (let start = 0; start < missing.length; start += batchSize) {
				const idx = missing.slice(start, start + batchSize);
				const vectors = await remote(idx.map((i) => texts[i]));
				await mkdir(dir, { recursive: true });
				await Promise.all(
					idx.map((i, k) => {
						out[i] = vectors[k];
						return writeFile(path(texts[i]), JSON.stringify(vectors[k])).catch(() => {});
					}),
				);
			}
			return out as number[][];
		},
	};
}
