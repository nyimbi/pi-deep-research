import { readFile } from "node:fs/promises";
import { extractHtml } from "../html-extract.ts";
import { pagesToMarkdown, pdfTextLayer } from "../pdf-text.ts";
import type { RawCapture } from "../raw-store.ts";
import type { LocalExtractSettings } from "../settings.ts";
import type { ExtractResult, SearchProvider, SearchRequest } from "../types.ts";

export interface LocalExtractDeps {
	/** Fetch under the fetch-safety policy and return the saved bytes. */
	capture: (url: string) => Promise<RawCapture>;
}

/**
 * Extraction that needs no network service: an in-process HTML extractor and the PDF text layer.
 * It declines (empty content, no breaker penalty) when the result is too thin to trust, so the
 * chain falls through to OCR or a cloud extractor. A text PDF never reaches the OCR server.
 */
export function createLocalExtractProvider(settings: LocalExtractSettings, deps: LocalExtractDeps): SearchProvider {
	const decline = (url: string, why: string): ExtractResult => {
		console.warn(`[pi-deep-research] local extract declined ${url}: ${why}`);
		return { title: "", url, content: "", wordCount: 0, provider: "local" };
	};
	return {
		name: "local",
		tier: "local",
		isConfigured: () => settings.enabled,
		search: async (_req: SearchRequest) => [],
		async extract(url: string): Promise<ExtractResult> {
			const capture = await deps.capture(url);
			const type = capture.contentType.toLowerCase();
			if (type.includes("application/pdf") || capture.suffix === ".pdf") {
				const layer = await pdfTextLayer(capture.path, { pdftotext: settings.pdftotext, maxPages: settings.maxPages });
				if (layer.charsPerPage < settings.minCharsPerPage) return decline(url, `text layer has ${layer.charsPerPage.toFixed(0)} characters per page, likely scanned`);
				const content = pagesToMarkdown(layer.pages);
				return { title: decodeURIComponent(new URL(url).pathname.split("/").pop() || new URL(url).hostname), url, content, wordCount: content.split(/\s+/).filter(Boolean).length, provider: "local" };
			}
			if (type.includes("html") || type.includes("xml") || capture.suffix === ".html") {
				const html = (await readFile(capture.path, "utf8")).slice(0, 5_000_000);
				const out = extractHtml(html, url);
				if (out.words < settings.minWords) return decline(url, `only ${out.words} words extracted, page may be client-rendered`);
				return { title: out.title, url, content: out.markdown, author: out.author, publishedDate: out.publishedDate, wordCount: out.words, provider: "local" };
			}
			return decline(url, `unsupported content type ${capture.contentType}`);
		},
	};
}
