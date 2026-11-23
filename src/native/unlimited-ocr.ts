import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RawCapture } from "../raw-store.ts";
import type { UocrSettings } from "../settings.ts";
import type { ExtractResult, SearchProvider, SearchRequest } from "../types.ts";

const run = promisify(execFile);

export type PageRenderer = (pdfPath: string, settings: UocrSettings) => Promise<Buffer[]>;

export interface UocrDeps {
	/** Fetch a URL under the fetch-safety policy and return the saved bytes. */
	capture: (url: string) => Promise<RawCapture>;
	fetchImpl?: typeof fetch;
	renderPages?: PageRenderer;
}

/** Render PDF pages to JPEG with poppler's pdftoppm. */
export const renderWithPdftoppm: PageRenderer = async (pdfPath, settings) => {
	const dir = await mkdtemp(join(tmpdir(), "uocr-"));
	try {
		await run(
			settings.pdftoppm,
			["-jpeg", "-r", String(settings.dpi), "-f", "1", "-l", String(settings.maxPages), pdfPath, join(dir, "p")],
			{ timeout: 120_000 },
		);
		const files = (await readdir(dir)).filter((name) => name.endsWith(".jpg")).sort();
		return await Promise.all(files.map((name) => readFile(join(dir, name))));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

interface ChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

function dataUrl(page: Buffer, mime: string): string {
	return `data:${mime};base64,${page.toString("base64")}`;
}

/** Strip page markers and the model's special tokens; keep one blank-line break per page. */
/** Block types that describe the page, not its content: running headers, footers and folios. */
const PAGE_FURNITURE = new Set(["header", "footer", "page_number"]);

/**
 * Turns the model's page-tagged output into Markdown. Page markers become rules. The layout form
 * `<BLOCK>type[x1, y1, x2, y2]<FORK>text` (seen from the llama.cpp build) loses its tag and box:
 * a title becomes a heading at its `<LEVELn>` depth (multi-page requests), `<MERGE>` markers are removed,
 * page furniture is dropped, every other type keeps its text.
 */
export function cleanOcrOutput(raw: string): string {
	return raw
		.replace(/<｜[^>]*｜>/g, "")
		.split("<PAGE>")
		.map((part) =>
			part
				.split("\n")
				.map((line) => {
					const m = /^\s*<BLOCK>([a-z_]+)(?:<LEVEL(\d)>)?\[[^\]]*\]<FORK>(.*)$/.exec(line);
					if (!m) return line.replace(/<\/?(?:BLOCK|FORK|MERGE)>/g, "");
					if (PAGE_FURNITURE.has(m[1])) return "";
					if (m[1] !== "title") return m[3];
					return `${"#".repeat(Math.min(Math.max(Number(m[2] ?? 1), 1), 6))} ${m[3].trim()}`;
				})
				.join("\n")
				.replace(/\n{3,}/g, "\n\n")
				.trim(),
		)
		.filter(Boolean)
		.join("\n\n---\n\n");
}

function imageMime(contentType: string): string | null {
	const type = contentType.split(";")[0].trim().toLowerCase();
	return ["image/jpeg", "image/png", "image/webp"].includes(type) ? type : null;
}

/**
 * Local OCR for PDFs and images via Baidu's Unlimited-OCR served over an
 * OpenAI-compatible chat endpoint: the SGLang build from the model card, or a llama.cpp server
 * carrying the Unlimited-OCR-2 patch (`backend: "llama-cpp"`).
 * Extraction only. Throws on HTML so the chain falls through to the next
 * extractor; place it before the generic fetch fallback in the provider list.
 */
export function createUnlimitedOcrProvider(settings: UocrSettings, deps: UocrDeps): SearchProvider {
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
	const render = deps.renderPages ?? renderWithPdftoppm;

	async function parse(pages: Buffer[], mime: string, signal?: AbortSignal): Promise<string> {
		const content: unknown[] = pages.map((page) => ({ type: "image_url", image_url: { url: dataUrl(page, mime) } }));
		// llama.cpp's embedded chat template adds <PAGE> before each image and the trained instruction when
		// the message has no text, so that backend gets images only and none of the SGLang-specific fields.
		if (settings.backend === "sglang") content.push({ type: "text", text: "<PAGE><image>".repeat(pages.length) + "Multi page parsing." });
		const body: Record<string, unknown> = {
			model: settings.model,
			messages: [{ role: "user", content }],
			max_tokens: settings.tokensPerPage * pages.length,
			temperature: 0,
			...(settings.backend === "sglang" ? { skip_special_tokens: false, images_config: { crop_mode: settings.cropMode } } : {}),
			// The patched build returns an empty completion when the whole prompt matches its prompt cache
			// (verified: a repeated identical request gave 0 characters; with cache_prompt false it gave the page).
			...(settings.backend === "llama-cpp" ? { cache_prompt: false } : {}),
		};
		if (settings.backend === "sglang" && settings.logitProcessor) {
			body.custom_logit_processor = settings.logitProcessor;
			body.custom_params = {
				ngram_size: settings.ngramSize,
				window_size: pages.length > 1 ? settings.windowSize : 128,
				page_token_id: 128827,
				eos_token_id: 1,
				max_page_tokens: 20000,
			};
		}
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
		const response = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok) {
			throw new Error(`Unlimited-OCR error ${response.status}: ${(await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
		}
		const data = (await response.json()) as ChatResponse;
		return data.choices?.[0]?.message?.content ?? "";
	}

	return {
		name: "unlimited-ocr",
		tier: "local",
		isConfigured: () => settings.baseUrl.trim() !== "",
		search: async (_req: SearchRequest) => [],
		async extract(url: string, signal?: AbortSignal): Promise<ExtractResult> {
			const capture = await deps.capture(url);
			const isPdf = capture.contentType.toLowerCase().includes("application/pdf") || capture.suffix === ".pdf";
			const mime = isPdf ? "image/jpeg" : imageMime(capture.contentType);
			if (!mime) throw new Error(`Unlimited-OCR handles PDFs and images, not ${capture.contentType}`);
			const pages = isPdf ? await render(capture.path, settings) : [await readFile(capture.path)];
			if (!pages.length) throw new Error(`no pages rendered from ${url}`);
			const parts: string[] = [];
			for (let start = 0; start < pages.length; start += settings.pagesPerRequest) {
				parts.push(await parse(pages.slice(start, start + settings.pagesPerRequest), mime, signal));
			}
			const content = cleanOcrOutput(parts.join("<PAGE>"));
			if (!content) throw new Error(`Unlimited-OCR returned no text for ${url}`);
			const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
			const clipped = isPdf && pages.length >= settings.maxPages ? `\n\n[... first ${settings.maxPages} pages only]` : "";
			return {
				title: heading || decodeURIComponent(new URL(url).pathname.split("/").pop() || new URL(url).hostname),
				url,
				content: content + clipped,
				wordCount: content.split(/\s+/).filter(Boolean).length,
				provider: "unlimited-ocr",
			};
		},
	};
}
