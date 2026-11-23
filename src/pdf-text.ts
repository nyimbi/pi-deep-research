/** PDF text layer via poppler's pdftotext, with a per-page character count to decide whether OCR is needed. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PdfText {
	pages: string[];
	/** Mean non-whitespace characters per page. */
	charsPerPage: number;
}

export async function pdfTextLayer(path: string, options: { pdftotext?: string; maxPages?: number } = {}): Promise<PdfText> {
	const { stdout } = await run(options.pdftotext ?? "pdftotext", ["-layout", "-f", "1", "-l", String(options.maxPages ?? 200), "-enc", "UTF-8", path, "-"], {
		timeout: 120_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const pages = stdout.split("\f");
	if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
	const total = pages.reduce((sum, p) => sum + p.replace(/\s+/g, "").length, 0);
	return { pages, charsPerPage: pages.length ? total / pages.length : 0 };
}

/** Markdown with a `[page N]` marker before each page's text. */
export function pagesToMarkdown(pages: string[]): string {
	return pages
		.map((text, i) => ({ n: i + 1, text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() }))
		.filter((p) => p.text)
		.map((p) => `[page ${p.n}]\n\n${p.text}`)
		.join("\n\n");
}
