/**
 * Turns a finalized report into one self-contained, offline HTML page: inline CSS, diagrams as data URIs
 * (light and dark), a contents list, a print stylesheet, a passage drawer behind every citation and a
 * colophon. Markdown is converted by a small purpose-built subset parser so the package keeps one runtime
 * dependency; raw HTML in the report is escaped, never emitted.
 */
import { LIGHT, DARK } from "./diagram-style.ts";
import { captionOf, mermaidBlocks } from "./diagrams.ts";
import { parseCalc } from "./calc.ts";
import { normalizeUrl } from "./normalize.ts";

export interface ReportDiagram {
	index: number;
	svg: string;
	dark?: string;
}

export interface CitedPassage {
	title: string;
	url: string;
	tier: number | string;
	/** The archived text; the passage shown is the paragraph that best matches the citing sentence. */
	content?: string;
	/** File name of the archived copy inside the package, when there is one. */
	archive?: string;
}

export interface ColophonRow {
	label: string;
	value: string;
}

export interface ReportPageOptions {
	title?: string;
	diagrams?: ReportDiagram[];
	/** Keyed by normalized URL. Links to these open their passage. */
	sources?: Map<string, CitedPassage>;
	colophon?: ColophonRow[];
	/** Notes under the colophon: what was not checked. */
	limits?: string[];
	generated?: string;
}

export function esc(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slug(text: string, used: Set<string>): string {
	let base = text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
	let id = base;
	for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
	used.add(id);
	return id;
}

interface Ctx {
	sources: Map<string, CitedPassage>;
	cited: Map<string, number>;
}

/** Inline Markdown: code, links, images, bold, italic. Everything else is text and is escaped. */
export function inline(text: string, ctx: Ctx): string {
	const stash: string[] = [];
	const keep = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
	let s = text.replace(/`([^`]+)`/g, (_m, c: string) => keep(`<code>${esc(c)}</code>`));
	s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => keep(`<img alt="${esc(alt)}" src="${esc(src)}">`));
	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
		const key = /^https?:/i.test(href) ? normalizeUrl(href) : "";
		const source = key ? ctx.sources.get(key) : undefined;
		if (source) {
			let n = ctx.cited.get(key);
			if (!n) {
				n = ctx.cited.size + 1;
				ctx.cited.set(key, n);
			}
			return keep(`<a class="cite" href="${esc(href)}" data-ref="${n}">${esc(label)}</a><sup class="ref"><a href="#ref-${n}">${n}</a></sup>`);
		}
		const safe = /^(https?:|mailto:|#|\.{0,2}\/)/i.test(href) ? href : "#";
		return keep(`<a href="${esc(safe)}">${esc(label)}</a>`);
	});
	s = esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "<em>$1</em>").replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "<em>$1</em>");
	return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)] ?? "");
}

const isTableRule = (l: string | undefined) => !!l && l.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
const splitRow = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

export interface Heading {
	level: number;
	id: string;
	text: string;
}

export interface Converted {
	html: string;
	headings: Heading[];
	/** Each cited source with the sentence that cited it first, in citation order. */
	cited: Array<{ n: number; key: string; sentence: string }>;
}

export function markdownToHtml(report: string, options: ReportPageOptions = {}): Converted {
	const ctx: Ctx = { sources: options.sources ?? new Map(), cited: new Map() };
	const diagrams = new Map((options.diagrams ?? []).map((d) => [d.index, d]));
	const blocks = mermaidBlocks(report);
	const byStart = new Map(blocks.map((b) => [b.start, b]));
	const headings: Heading[] = [];
	const used = new Set<string>();
	const firstSentence = new Map<string, string>();
	const lines = report.split("\n");
	const out: string[] = [];
	let offset = 0;
	const lineStart: number[] = lines.map((l) => {
		const at = offset;
		offset += l.length + 1;
		return at;
	});
	const note = (text: string) => {
		for (const m of text.matchAll(/\]\((https?:[^)\s]+)\)/g)) {
			const key = normalizeUrl(m[1]!);
			if (ctx.sources.has(key) && !firstSentence.has(key)) {
				const around = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
				firstSentence.set(key, around);
			}
		}
	};
	let i = 0;
	let skippedFirstH1 = false;
	while (i < lines.length) {
		const line = lines[i]!;
		const block = byStart.get(lineStart[i]!);
		if (block) {
			const end = block.end;
			while (i < lines.length && lineStart[i]! < end) i++;
			const d = diagrams.get(block.index);
			if (d) {
				const caption = captionOf(report, block) ?? `Diagram ${block.index}`;
				const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
				const dark = d.dark ? `<source media="(prefers-color-scheme: dark)" srcset="${uri(d.dark)}">` : "";
				out.push(`<figure class="diagram"><picture>${dark}<img alt="${esc(caption)}" src="${uri(d.svg)}"></picture></figure>`);
			} else out.push(`<pre class="mermaid-source"><code>${esc(block.source)}</code></pre>`);
			continue;
		}
		const fence = line.match(/^```(\w*)/);
		if (fence) {
			const body: string[] = [];
			i++;
			while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
			i++;
			if (fence[1] === "calc") {
				const show = (v: number | null) => (v === null ? "n/a" : Number(v.toFixed(4)).toLocaleString("en-US", { maximumFractionDigits: 4 }));
				const rows = parseCalc(body.join("\n")).map((r) => {
					const basis = r.formula ? `<code>${esc(r.formula)}</code>` : r.source === "assumed" ? "assumed" : r.source ? inline(`[source](${r.source})`, ctx) : "";
					return `<tr><td>${esc(r.name)}</td><td style="text-align:right">${show(r.value)}</td><td>${basis}</td></tr>`;
				});
				out.push(`<div class="table-wrap calc"><table><thead><tr><th>Calculation</th><th style="text-align:right">Value</th><th>From</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`);
				continue;
			}
			out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
			continue;
		}
		const h = line.match(/^(#{1,4})\s+(.*)$/);
		if (h) {
			const level = h[1]!.length;
			i++;
			if (level === 1 && !skippedFirstH1) {
				skippedFirstH1 = true;
				continue;
			}
			const id = slug(h[2]!, used);
			headings.push({ level, id, text: h[2]!.replace(/[`*_]/g, "") });
			out.push(`<h${level} id="${id}">${inline(h[2]!, ctx)}</h${level}>`);
			continue;
		}
		if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			out.push("<hr>");
			i++;
			continue;
		}
		if (!line.trim() || /^<!--.*-->\s*$/.test(line.trim())) {
			i++;
			continue;
		}
		if (/^\s*\|/.test(line) && isTableRule(lines[i + 1])) {
			const head = splitRow(line);
			const aligns = splitRow(lines[i + 1]!).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(splitRow(lines[i++]!));
			const cell = (tag: string, c: string, k: number) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ""}>${inline(c, ctx)}</${tag}>`;
			for (const r of rows) note(r.join(" | "));
			out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_c, k) => cell("td", r[k] ?? "", k)).join("")}</tr>`).join("")}</tbody></table></div>`);
			continue;
		}
		if (/^>\s?/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^>\s?/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ""));
			note(body.join(" "));
			out.push(`<blockquote><p>${inline(body.join(" "), ctx)}</p></blockquote>`);
			continue;
		}
		const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
		if (li) {
			const ordered = /\d/.test(li[2]!);
			const items: string[] = [];
			while (i < lines.length) {
				const m = lines[i]!.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
				if (m && /\d/.test(m[2]!) === ordered && m[1]!.length < 2) items.push(m[3]!);
				else if (m && items.length) items[items.length - 1] += ` ${m[3]!}`;
				else if (/^\s{2,}\S/.test(lines[i]!) && items.length) items[items.length - 1] += ` ${lines[i]!.trim()}`;
				else break;
				i++;
			}
			for (const it of items) note(it);
			const tag = ordered ? "ol" : "ul";
			out.push(`<${tag}>${items.map((t) => `<li>${inline(t, ctx)}</li>`).join("")}</${tag}>`);
			continue;
		}
		const para: string[] = [];
		while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|>\s?|\s*\|)/.test(lines[i]!) && !/^(\s*)([-*]|\d+[.)])\s+/.test(lines[i]!) && !byStart.has(lineStart[i]!)) para.push(lines[i++]!.trim());
		if (!para.length) {
			para.push(lines[i++]!.trim());
		}
		const text = para.join(" ");
		note(text);
		out.push(`<p>${inline(text, ctx)}</p>`);
	}
	const cited = [...ctx.cited].map(([key, n]) => ({ n, key, sentence: firstSentence.get(key) ?? "" }));
	return { html: out.join("\n"), headings, cited };
}

const PRINT_AND_SCREEN = (): string => {
	const t = (s: typeof LIGHT) => `--paper:${s.paper};--ink:${s.ink};--muted:${s.muted};--soft:${s.soft};--accent:${s.accent};--tint:${s.accentTint};--node:${s.node};`;
	return `:root{${t(LIGHT)}--rule:rgba(45,49,66,0.16);--serif:"Instrument Serif",Georgia,"Times New Roman",serif;--sans:Geist,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${t(DARK)}--rule:rgba(245,245,245,0.18)}}
:root[data-theme=dark]{${t(DARK)}--rule:rgba(245,245,245,0.18)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 var(--sans)}
.page{display:grid;grid-template-columns:minmax(0,15rem) minmax(0,42rem);gap:3rem;max-width:64rem;margin:0 auto;padding:3rem 1rem 5rem}
header.title{grid-column:1/-1;border-bottom:1px solid var(--rule);padding-bottom:1.5rem}
.eyebrow{font:500 .72rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 .9rem}
h1{font:400 clamp(2rem,5vw,3.1rem)/1.1 var(--serif);margin:0;letter-spacing:-.01em}
nav.toc{position:sticky;top:1.5rem;align-self:start;font-size:.85rem;max-height:calc(100vh - 3rem);overflow:auto}
nav.toc p{font:500 .7rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--soft);margin:0 0 .8rem}
nav.toc ol{list-style:none;margin:0;padding:0}nav.toc li{margin:0 0 .4rem}nav.toc li.l3{padding-left:.9rem;color:var(--muted)}
nav.toc a{color:var(--muted);text-decoration:none}nav.toc a:hover{color:var(--accent)}
main{min-width:0}
h2{font:400 1.7rem/1.2 var(--serif);margin:2.6rem 0 .8rem;padding-top:.4rem}h3{font:600 1.05rem/1.3 var(--sans);margin:1.8rem 0 .4rem}h4{font:600 .95rem var(--sans);margin:1.4rem 0 .3rem;color:var(--muted)}
p,ul,ol,blockquote{margin:0 0 1rem}li{margin:0 0 .35rem}
a{color:var(--ink);text-decoration-color:var(--accent);text-underline-offset:.18em}a:hover{color:var(--accent)}
a.cite{text-decoration-style:dotted}sup.ref{font:500 .65rem var(--mono);margin-left:.1rem}sup.ref a{color:var(--accent);text-decoration:none}
code{font:.86em var(--mono);background:var(--tint);padding:.08em .3em;border-radius:3px}
pre{background:var(--node);border:1px solid var(--rule);border-radius:6px;padding:.9rem 1rem;overflow:auto;font-size:.82rem;line-height:1.5}pre code{background:none;padding:0}
hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
blockquote{border-left:2px solid var(--accent);padding:.1rem 0 .1rem 1rem;color:var(--muted)}blockquote p{margin:0}
.table-wrap{overflow-x:auto;margin:0 0 1.2rem;border:1px solid var(--rule);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:.88rem;font-variant-numeric:tabular-nums}
th{font:500 .7rem/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--soft);text-align:left}
th,td{padding:.55rem .75rem;border-bottom:1px solid var(--rule);vertical-align:top}tr:last-child td{border-bottom:0}
figure.diagram{margin:1.4rem 0;padding:1rem;background:var(--paper);border:1px solid var(--rule);border-radius:6px}figure.diagram img{display:block;max-width:100%;height:auto;margin:0 auto}
details.passage{border:1px solid var(--rule);border-radius:6px;padding:.7rem 1rem;margin:0 0 .8rem;font-size:.88rem}
details.passage summary{cursor:pointer;color:var(--ink)}details.passage[open]{background:var(--tint)}
details.passage blockquote{margin:.7rem 0 .3rem}.meta{font:.72rem var(--mono);color:var(--soft)}
.tier{font:500 .65rem var(--mono);letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--rule);border-radius:2px;padding:.05rem .35rem;margin-right:.4rem;color:var(--muted)}
.tier.t1{border-color:var(--accent);color:var(--accent)}
section.colophon{margin-top:3rem;padding-top:1.4rem;border-top:1px solid var(--rule);font-size:.85rem;color:var(--muted)}
section.colophon dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1.2rem;margin:0 0 1rem}section.colophon dt{font:500 .7rem var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--soft)}section.colophon dd{margin:0}
@media (max-width:52rem){.page{grid-template-columns:minmax(0,1fr);gap:1.5rem;padding:1.5rem 1rem 3rem}nav.toc{position:static;max-height:none}}
@media print{:root{--paper:#fff;--ink:#1d2030;--muted:#444c5e;--soft:#5a6580;--tint:rgba(191,69,32,.06);--node:#f3f3f3;--accent:#bf4520}
body{font-size:10.5pt;line-height:1.5}.page{display:block;max-width:none;padding:0}nav.toc{display:none}h2,h3,h4{break-after:avoid}figure,table,blockquote,pre{break-inside:avoid}
details.passage{break-inside:avoid}details.passage:not([open])>*:not(summary){display:block}a{text-decoration:none}a.cite::after{content:""}}`;
};

const SCRIPT = `document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a.cite");if(!a)return;var d=document.getElementById("ref-"+a.dataset.ref);if(!d)return;e.preventDefault();d.open=true;d.scrollIntoView({block:"center"});history.replaceState(null,"","#ref-"+a.dataset.ref)});`;

export function renderReportPage(report: string, options: ReportPageOptions = {}): { html: string; headings: Heading[]; cited: number } {
	const converted = markdownToHtml(report, options);
	const title = options.title ?? report.match(/^#\s+(.+)$/m)?.[1]?.replace(/[`*_]/g, "") ?? "Research report";
	const toc = converted.headings
		.filter((h) => h.level === 2 || h.level === 3)
		.map((h) => `<li class="l${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`)
		.join("");
	const refs = converted.cited
		.map(({ n, key, sentence }) => {
			const s = options.sources?.get(key)!;
			const tier = String(s.tier);
			const found = s.content ? bestPassage(sentence, s.content) : "";
			const passage = found ? `<blockquote><p>${esc(found)}</p></blockquote>` : `<p class="meta">No passage in the archived text matches the citing sentence; open the source.</p>`;
			const archive = s.archive ? ` · archived as <code>${esc(s.archive)}</code>` : "";
			return `<details class="passage" id="ref-${n}"><summary><span class="tier${tier === "1" ? " t1" : ""}">Tier ${esc(tier)}</span>${esc(s.title)}</summary>${sentence ? `<p class="meta">Cited for: ${esc(sentence.slice(0, 240))}</p>` : ""}${passage}<p class="meta"><a href="${esc(s.url)}">${esc(s.url)}</a>${archive}</p></details>`;
		})
		.join("\n");
	const colophon = options.colophon?.length
		? `<section class="colophon" id="colophon"><h2>Method and limits</h2><dl>${options.colophon.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl>${options.limits?.length ? `<ul>${options.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}</section>`
		: "";
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<style>${PRINT_AND_SCREEN()}</style></head>
<body><div class="page">
<header class="title"><p class="eyebrow">Research report${options.generated ? ` · ${esc(options.generated)}` : ""}</p><h1>${esc(title)}</h1></header>
<nav class="toc" aria-label="Contents"><p>Contents</p><ol>${toc}${refs ? `<li><a href="#passages">Passages</a></li>` : ""}${colophon ? `<li><a href="#colophon">Method and limits</a></li>` : ""}</ol></nav>
<main>
${converted.html}
${refs ? `<section id="passages"><h2>Passages</h2><p class="meta">Each citation above opens the archived passage it rests on.</p>${refs}</section>` : ""}
${colophon}
</main></div>
<script>${SCRIPT}</script>
</body></html>
`;
	return { html, headings: converted.headings, cited: converted.cited.length };
}

/** The archived paragraph that shares the most words with the citing sentence. Empty when nothing overlaps. */
export function bestPassage(sentence: string, content: string): string {
	const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
	const want = words(sentence);
	if (!want.size) return "";
	let best = "";
	let score = 0;
	for (const para of content.split(/\n{2,}/)) {
		const p = para.replace(/\s+/g, " ").trim();
		if (p.length < 40) continue;
		const have = words(p);
		let hit = 0;
		for (const w of want) if (have.has(w)) hit++;
		const s = hit / Math.sqrt(have.size || 1);
		if (hit >= 2 && s > score) {
			score = s;
			best = p;
		}
	}
	return best.length > 700 ? `${best.slice(0, 697)}...` : best;
}
