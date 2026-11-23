/**
 * Publication checks that a structural gate cannot see, taken from machine-works' rule that a page explains the
 * thing, not only shows it. Findings are warnings: they ask for better writing, they do not block a package.
 *
 * - At deep and exhaustive depth the report needs a section that explains how the subject works.
 * - Every diagram label must be a term the prose uses, so the figure and the text name things the same way.
 */
import { mermaidBlocks } from "./diagrams.ts";

const MECHANISM = /\b(how (?:it|this|[\w-]+(?: [\w-]+)?) works|mechanism|under the hood|how it (?:is|was) built|architecture|operation)\b/i;
const STOP = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "start", "end", "yes", "no", "else"]);

function sections(report: string): Array<{ heading: string; body: string }> {
	const parts = report.split(/^(?=##\s)/m).filter((p) => /^##\s/.test(p));
	return parts.map((p) => ({ heading: p.split("\n")[0]!.replace(/^##\s+/, ""), body: p.split("\n").slice(1).join("\n") }));
}

function paragraphs(body: string): number {
	return body.split(/\n{2,}/).filter((p) => p.trim().split(/\s+/).length >= 25 && !/^(\s*[-*|#>`]|\s*\d+[.)])/.test(p)).length;
}

export function checkMechanism(report: string, depth: string): string[] {
	if (depth !== "deep" && depth !== "exhaustive") return [];
	const found = sections(report).find((s) => MECHANISM.test(s.heading));
	if (!found) return ['no section explains how the subject works: add one headed e.g. "## How it works" with the mechanism in prose, in the report\'s own numbers'];
	const n = paragraphs(found.body);
	return n >= 3 ? [] : [`"## ${found.heading}" has ${n} explanatory paragraph(s); explain the mechanism in at least 3`];
}

/** Words that name a thing, lowercased, without punctuation or stop words. */
function terms(text: string): string[] {
	return (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w));
}

export function diagramLabels(source: string): string[] {
	const out: string[] = [];
	for (const line of source.split("\n")) {
		if (/^\s*(%%|style|classDef|class|linkStyle|click|direction|subgraph|end\b)/.test(line)) {
			const sg = line.match(/^\s*subgraph\s+(?:\w+\s*)?\[?"?([^\]"]+)"?\]?/);
			if (sg) out.push(sg[1]!.trim());
			continue;
		}
		for (const m of line.matchAll(/\[\(?"?([^\]"()]+?)"?\)?\]|\{"?([^}"]+?)"?\}|\(\(?"?([^)"]+?)"?\)?\)/g)) out.push((m[1] ?? m[2] ?? m[3] ?? "").replace(/<br\s*\/?>/gi, " ").trim());
	}
	return out.filter((l) => terms(l).length > 0);
}

export function checkLabelTerms(report: string): string[] {
	const blocks = mermaidBlocks(report);
	let prose = report;
	for (const b of [...blocks].reverse()) prose = prose.slice(0, b.start) + prose.slice(b.end);
	const have = new Set(terms(prose.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
	const out: string[] = [];
	for (const b of blocks) {
		const missing = [...new Set(diagramLabels(b.source))].filter((label) => terms(label).every((w) => !have.has(w)));
		if (missing.length) out.push(`diagram ${b.index} labels ${missing.slice(0, 4).map((m) => `"${m}"`).join(", ")} with terms the prose never uses; name each thing the same way in the text`);
	}
	return out;
}
