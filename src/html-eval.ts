/** Token-level F1 of extracted text against hand-written gold main content, per page type. */
import { extractHtml } from "./html-extract.ts";

export interface HtmlFixturePage {
	type: string;
	html: string;
	gold: string;
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function f1(extracted: string, gold: string): number {
	const a = tokens(extracted);
	const g = new Map<string, number>();
	for (const t of tokens(gold)) g.set(t, (g.get(t) ?? 0) + 1);
	let hit = 0;
	for (const t of a) {
		const n = g.get(t) ?? 0;
		if (n > 0) {
			hit += 1;
			g.set(t, n - 1);
		}
	}
	const goldN = tokens(gold).length;
	if (!hit || !a.length || !goldN) return 0;
	const p = hit / a.length;
	const r = hit / goldN;
	return (2 * p * r) / (p + r);
}

/** The pre-existing fetch fallback, kept here as the baseline to beat. */
export function baselineStrip(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[\s\S]*?<\/nav>/gi, "")
		.replace(/<header[\s\S]*?<\/header>/gi, "")
		.replace(/<footer[\s\S]*?<\/footer>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&[^;]+;/g, " ");
}

export function evaluateHtml(pages: HtmlFixturePage[], extract: (html: string) => string): Record<string, number> {
	const byType = new Map<string, number[]>();
	for (const page of pages) byType.set(page.type, [...(byType.get(page.type) ?? []), f1(extract(page.html), page.gold)]);
	return Object.fromEntries([...byType].map(([type, scores]) => [type, scores.reduce((s, x) => s + x, 0) / scores.length]));
}

export const local = (html: string): string => extractHtml(html, "https://example.com/").markdown;
