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
	/** Offsets of the whole fenced block in the report. */
	start: number;
	end: number;
}

export function mermaidBlocks(report: string): DiagramBlock[] {
	const blocks: DiagramBlock[] = [];
	const re = /^[ \t]*```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(report))) blocks.push({ index: blocks.length + 1, source: m[1], start: m.index, end: m.index + m[0].length });
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

/** Table rows of the report as cell lists, with the separator rows removed. */
function tableRows(report: string): string[][] {
	const rows: string[][] = [];
	let fenced = false;
	for (const line of report.split("\n")) {
		if (/^\s*```/.test(line)) fenced = !fenced;
		if (fenced || !/^\s*\|.*\|\s*$/.test(line) || /^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
		rows.push(line.trim().slice(1, -1).split("|").map((cell) => cell.replace(/[*_`]/g, "").trim().toLowerCase()));
	}
	return rows;
}

function asNumber(cell: string): number | null {
	const plain = cell.replace(/,/g, "").replace(/\s?%$/, "").replace(/^[$€£]/, "");
	return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
}

/** The (label, value) points a pie or xychart-beta block plots; null for other types. */
export function chartPoints(source: string): Array<{ label: string; value: number }> | null {
	const lines = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	const kind = lines[0]?.split(/\s/)[0];
	if (kind === "pie") {
		const points: Array<{ label: string; value: number }> = [];
		for (const line of lines.slice(1)) {
			const m = /^"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line);
			if (m) points.push({ label: m[1], value: Number(m[2]) });
		}
		return points;
	}
	if (kind === "xychart-beta") {
		const list = (text: string) => text.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
		const axis = lines.map((l) => /^x-axis\s+(?:"[^"]*"\s+)?\[(.*)\]\s*$/.exec(l)).find(Boolean);
		if (!axis) return [];
		const labels = list(axis[1]);
		const points: Array<{ label: string; value: number }> = [];
		for (const line of lines) {
			const m = /^(?:bar|line)\s+(?:"[^"]*"\s+)?\[(.*)\]\s*$/.exec(line);
			if (m) list(m[1]).forEach((v, i) => { if (v !== "" && !Number.isNaN(Number(v))) points.push({ label: labels[i] ?? `(no category ${i + 1})`, value: Number(v) }); });
		}
		return points;
	}
	return null;
}

/** Every plotted point must be a row of a table in the report: that row's cells hold the label and the value. */
function chartIssues(source: string, report: string, label: string): string[] {
	const points = chartPoints(source);
	if (points === null) return [];
	if (!points.length) return [`${label} is a chart with no readable data points`];
	const rows = tableRows(report);
	if (!rows.length) return [`${label} plots ${points.length} figure(s) but the report has no table to back them`];
	return points
		.filter((p) => !rows.some((row) => row.includes(p.label.toLowerCase()) && row.some((cell) => asNumber(cell) === p.value)))
		.map((p) => `${label} plots ${p.label} = ${p.value}, which matches no row of any table in the report`);
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
		out.push(...chartIssues(block.source, report, label));
		const urls = block.source.split("\n").filter((l) => /^\s*%%\s*source:/i.test(l)).flatMap((l) => extractUrls(l));
		const unknown = urls.filter((u) => !ledger.source(u));
		if (unknown.length) out.push(`${label} cites ${unknown.length} source(s) the tools never returned: ${unknown.join(", ")}`);
		const labels = block.source.split("\n").filter((l) => !/^\s*%%/.test(l)).join(" ");
		const known = urls.filter((u) => ledger.source(u));
		if (!known.length) {
			if (chartPoints(block.source) === null && /(?<![\w.,])(\d+\.\d+|\d{3,}|\d+\s?%)/.test(labels)) out.push(`${label} shows figures but names no source; add "%% source: <url>" inside the block`);
			continue;
		}
		const issues = checkClaims(`- ${labels} ${known.join(" ")}`, (url) => ledger.source(url)?.extracted?.content);
		for (const line of describeClaimIssues(issues)) out.push(`${label}: ${line}`);
	}
	return out;
}

const EDGE = /-\.->|\.->|==>|-->|---|--[ox]/g;
const LABELED = /(?:-->|---|==>|-\.->)\s*\|[^|]+\||--\s+[^-|>\s][^-|>]*?\s+-->|==\s+[^=|>\s][^=|>]*?\s+==>|-\.\s+[^-.|>\s][^|>]*?\s+\.->/g;
const MAX_NODES = 15;
const NOT_EDGE_LINE = /^(?:subgraph|end\b|style|classDef|class|click|linkStyle|direction|%%)/;

function proseLine(line: string | undefined): boolean {
	if (!line) return false;
	const text = line.trim();
	return !/^(?:#|```|\||<!--)/.test(text) && text.split(/\s+/).length >= 5;
}

/** Style findings, always warnings: a caption beside each diagram and labelled arrows. */
export function lintDiagrams(report: string): string[] {
	const out: string[] = [];
	for (const block of mermaidBlocks(report)) {
		const label = `diagram ${block.index}`;
		const before = report.slice(0, block.start).split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
		const after = report.slice(block.end).split("\n").map((l) => l.trim()).find(Boolean);
		if (!proseLine(before) && !proseLine(after)) out.push(`${label} has no caption: put a sentence of five words or more, saying what the picture shows, directly before or after it`);
		const lines = block.source.split("\n").map((l) => l.trim());
		const kind = lines.find((l) => l && !l.startsWith("%%"))?.split(/[\s;]/)[0];
		if (kind === "flowchart" || kind === "graph") {
			let edges = 0;
			let labeled = 0;
			for (const line of lines) {
				if (!line || NOT_EDGE_LINE.test(line)) continue;
				edges += (line.match(EDGE) ?? []).length;
				labeled += (line.match(LABELED) ?? []).length;
			}
			const nodes = new Set<string>();
			for (const line of lines) {
				if (!line || NOT_EDGE_LINE.test(line) || !EDGE.test(line)) continue;
				EDGE.lastIndex = 0;
				for (const seg of line.split(EDGE)) {
					const id = /^\s*(?:\|[^|]*\|)?\s*&?\s*([A-Za-z_]\w*)/.exec(seg.replace(/^\s*\|[^|]*\|/, ""));
					if (id) nodes.add(id[1]);
				}
			}
			if (nodes.size > MAX_NODES) out.push(`${label} has ${nodes.size} nodes; past ${MAX_NODES} a flowchart stops being read, so split it or drop what the argument does not turn on`);
			if (edges >= 2 && labeled * 2 < edges) out.push(`${label} labels ${labeled} of ${edges} arrows; an unlabelled arrow says only "related"`);
		} else if (kind === "sequenceDiagram") {
			const bare = lines.filter((l) => /^[^%]*?(?:->>|-->>|->|-->|-x|--x|-\)|--\))/.test(l) && !/^(?:participant|actor|note|loop|alt|opt|par|rect|autonumber|activate|deactivate)\b/i.test(l) && !l.includes(":"));
			if (bare.length) out.push(`${label} has ${bare.length} message(s) with no text`);
		}
	}
	const seen = new Map<string, number>();
	for (const block of mermaidBlocks(report)) {
		const key = block.source.replace(/\s+/g, " ").trim();
		const first = seen.get(key);
		if (first) out.push(`diagram ${block.index} repeats diagram ${first}`);
		else seen.set(key, block.index);
	}
	if (/^##\s+Comparison\b/im.test(report) && !mermaidBlocks(report).length) out.push("the Comparison section has no diagram; a before and after drawing shows what each option adds or removes");
	return out;
}

/** Adds an image link after each fenced diagram whose SVG was written, so a viewer without Mermaid still shows the picture. */
export function embedRenderedDiagrams(report: string, rendered: Iterable<number>): string {
	const ok = new Set(rendered);
	let out = "";
	let at = 0;
	for (const block of mermaidBlocks(report)) {
		if (!ok.has(block.index)) continue;
		out += `${report.slice(at, block.end)}\n\n![Diagram ${block.index}](diagrams/diagram-${block.index}.svg)`;
		at = block.end;
	}
	return out + report.slice(at);
}
