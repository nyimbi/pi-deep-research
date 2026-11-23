/**
 * Mermaid blocks in a report. A diagram is a claim, so it gets the same treatment as a sentence:
 * a structural check, then the deterministic number check against sources the diagram names with
 * `%% source: <url>` comments. No renderer is needed; `mmdc` can render the same text afterwards.
 */
import { checkClaims, describeClaimIssues } from "./claim-check.ts";
import type { SourceLedger } from "./ledger.ts";
import { extractUrls } from "./normalize.ts";

const TYPES = [
	"flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram", "gantt", "pie", "timeline",
	"journey", "mindmap", "quadrantChart", "xychart-beta", "gitGraph", "sankey-beta", "block-beta", "requirementDiagram", "architecture-beta",
];

export interface DiagramBlock {
	index: number;
	source: string;
}

export function mermaidBlocks(report: string): DiagramBlock[] {
	const blocks: DiagramBlock[] = [];
	const re = /^[ \t]*```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(report))) blocks.push({ index: blocks.length + 1, source: m[1] });
	return blocks;
}

function structural(source: string): string | null {
	const lines = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	if (!lines.length) return "is empty";
	const first = lines[0].replace(/^---[\s\S]*$/, "").split(/[\s;]/)[0];
	if (!TYPES.includes(first)) return `starts with "${lines[0].slice(0, 30)}", which is not a Mermaid diagram type`;
	const stack: string[] = [];
	const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
	for (const line of lines.slice(1)) {
		let quoted = false;
		for (const ch of line) {
			if (ch === '"') quoted = !quoted;
			else if (!quoted && "([{".includes(ch)) stack.push(ch);
			else if (!quoted && ch in pairs && stack.pop() !== pairs[ch]) return `has an unbalanced "${ch}" in: ${line.slice(0, 60)}`;
		}
		if (quoted) return `has an unterminated quote in: ${line.slice(0, 60)}`;
	}
	if (stack.length) return `has an unclosed "${stack[stack.length - 1]}"`;
	return null;
}

/** Messages for finalize; empty when every diagram is well formed and its figures are sourced. */
export function checkDiagrams(report: string, ledger: SourceLedger): string[] {
	const out: string[] = [];
	for (const block of mermaidBlocks(report)) {
		const label = `diagram ${block.index}`;
		const problem = structural(block.source);
		if (problem) {
			out.push(`${label} ${problem}`);
			continue;
		}
		const urls = block.source.split("\n").filter((l) => /^\s*%%\s*source:/i.test(l)).flatMap((l) => extractUrls(l));
		const unknown = urls.filter((u) => !ledger.source(u));
		if (unknown.length) out.push(`${label} cites ${unknown.length} source(s) the tools never returned: ${unknown.join(", ")}`);
		const labels = block.source.split("\n").filter((l) => !/^\s*%%/.test(l)).join(" ");
		const known = urls.filter((u) => ledger.source(u));
		if (!known.length) {
			if (/(?<![\w.,])(\d+\.\d+|\d{3,}|\d+\s?%)/.test(labels)) out.push(`${label} shows figures but names no source; add "%% source: <url>" inside the block`);
			continue;
		}
		const issues = checkClaims(`- ${labels} ${known.join(" ")}`, (url) => ledger.source(url)?.extracted?.content);
		for (const line of describeClaimIssues(issues)) out.push(`${label}: ${line}`);
	}
	return out;
}
