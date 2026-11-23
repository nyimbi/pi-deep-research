import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { RawCapture } from "../raw-store.ts";
import type { DoclingSettings } from "../settings.ts";
import type { ExtractResult, SearchProvider, SearchRequest } from "../types.ts";

const run = promisify(execFile);

export interface DoclingDeps {
	capture: (url: string) => Promise<RawCapture>;
}

const DOCUMENT = /\.(pdf|docx|pptx|xlsx|png|jpe?g|tiff?)$/i;
const DOCUMENT_TYPE = /pdf|officedocument|image\//i;

/** Arguments for the docling CLI. The standard pipeline gives layout and tables; a VLM preset replaces it. */
export function doclingArgs(settings: DoclingSettings, input: string, outDir: string): string[] {
	const args = ["--to", "md", "--image-export-mode", "placeholder", "--device", settings.device, "--output", outDir];
	if (settings.vlmModel) args.push("--pipeline", "vlm", "--vlm-model", settings.vlmModel);
	else if (!settings.ocr) args.push("--no-ocr");
	args.push(input);
	return args;
}

/**
 * Layout-aware document conversion through the Docling CLI. Heavier than the local text layer, so it
 * sits after it in the chain and is off by default: it takes scans, office files and layouts the
 * text layer flattens. Output is Markdown with tables.
 */
export function createDoclingProvider(settings: DoclingSettings, deps: DoclingDeps): SearchProvider {
	return {
		name: "docling",
		tier: "local",
		isConfigured: () => settings.enabled,
		search: async (_req: SearchRequest) => [],
		async extract(url: string, signal?: AbortSignal): Promise<ExtractResult> {
			const capture = await deps.capture(url);
			const isDocument = DOCUMENT_TYPE.test(capture.contentType) || DOCUMENT.test(capture.suffix);
			if (!isDocument) return { title: "", url, content: "", wordCount: 0, provider: "docling" };
			const outDir = await mkdtemp(join(tmpdir(), "docling-"));
			try {
				await run(settings.command, doclingArgs(settings, capture.path, outDir), { timeout: settings.timeoutMs, signal, maxBuffer: 16 * 1024 * 1024 });
				const md = (await readdir(outDir)).find((f) => f.endsWith(".md"));
				if (!md) throw new Error("docling produced no Markdown output");
				const content = (await readFile(join(outDir, md), "utf8")).trim();
				const title = decodeURIComponent(basename(new URL(url).pathname) || new URL(url).hostname);
				return { title, url, content, wordCount: content.split(/\s+/).filter(Boolean).length, provider: "docling" };
			} finally {
				await rm(outDir, { recursive: true, force: true });
			}
		},
	};
}
