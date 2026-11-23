/**
 * Local HTML to Markdown extractor with no dependencies. A small tree parser, a boilerplate
 * and hidden-content filter, main-content selection by text density, and a Markdown writer.
 * Hidden elements (hidden, aria-hidden, display:none, visibility:hidden), image alt text,
 * scripts and comments are dropped, which also removes common prompt-injection hiding spots.
 */

interface El {
	tag: string;
	attrs: Record<string, string>;
	children: Array<El | string>;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const DROP = new Set(["script", "style", "noscript", "svg", "template", "iframe", "canvas", "object", "embed", "form", "select", "button", "dialog", "head", "nav", "footer", "aside", "audio", "video"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "ul", "ol", "li", "table", "tr", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "dl", "dt", "dd", "figure", "figcaption", "header", "details", "summary", "address", "fieldset"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', copy: "(c)", middot: "." };

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
		if (body[0] === "#") {
			const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[body.toLowerCase()] ?? match;
	});
}

function parseAttrs(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const m of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
		attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
	}
	return attrs;
}

export function parseHtml(html: string): El {
	const root: El = { tag: "#root", attrs: {}, children: [] };
	const stack: El[] = [root];
	const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!doctype[^>]*>/gi, "");
	const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(clean))) {
		const top = stack[stack.length - 1];
		if (m[4] !== undefined) {
			top.children.push(m[4]);
			continue;
		}
		const tag = m[2].toLowerCase();
		if (m[1]) {
			const at = stack.map((e) => e.tag).lastIndexOf(tag);
			if (at > 0) stack.length = at;
			continue;
		}
		if (tag === "script" || tag === "style") {
			const end = clean.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
			re.lastIndex = end < 0 ? clean.length : clean.indexOf(">", end) + 1 || clean.length;
			continue;
		}
		// An unclosed <p> or <li> ends when the next one starts.
		if ((tag === "p" || tag === "li") && top.tag === tag) stack.pop();
		const el: El = { tag, attrs: parseAttrs(m[3] ?? ""), children: [] };
		stack[stack.length - 1].children.push(el);
		if (!VOID.has(tag) && !(m[3] ?? "").trimEnd().endsWith("/")) stack.push(el);
	}
	return root;
}

function hidden(el: El): boolean {
	const a = el.attrs;
	if ("hidden" in a || a["aria-hidden"] === "true") return true;
	return /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])/i.test(a.style ?? "");
}

const NOISE = /(^|[\s_-])(nav|menu|sidebar|footer|cookie|banner|advert|ads?|promo|share|social|breadcrumb|newsletter|popup|modal|comment-form|related)([\s_-]|$)/i;

function noisy(el: El): boolean {
	return NOISE.test(`${el.attrs.class ?? ""} ${el.attrs.id ?? ""}`) || ["navigation", "banner", "contentinfo", "complementary", "search"].includes(el.attrs.role ?? "");
}

function prune(el: El): El {
	return { ...el, children: el.children.filter((c) => typeof c === "string" || !(DROP.has(c.tag) || hidden(c) || noisy(c))).map((c) => (typeof c === "string" ? c : prune(c))) };
}

function textOf(el: El | string): string {
	if (typeof el === "string") return el;
	return el.children.map(textOf).join(" ");
}

function textLen(el: El | string): number {
	return textOf(el).replace(/\s+/g, " ").trim().length;
}

function linkLen(el: El | string): number {
	if (typeof el === "string") return 0;
	if (el.tag === "a") return textLen(el);
	return el.children.reduce((sum, c) => sum + linkLen(c), 0);
}

function find(el: El, test: (e: El) => boolean): El | null {
	for (const c of el.children) {
		if (typeof c === "string") continue;
		if (test(c)) return c;
		const deeper = find(c, test);
		if (deeper) return deeper;
	}
	return null;
}

/** Pick the main content: <main>/<article>/role=main, else descend into the dominant child. */
function mainOf(body: El): El {
	const landmark = find(body, (e) => e.tag === "main" || e.attrs.role === "main") ?? find(body, (e) => e.tag === "article" && textLen(e) > 200);
	if (landmark && textLen(landmark) >= textLen(body) * 0.3) return landmark;
	let node = body;
	for (let depth = 0; depth < 12; depth++) {
		const kids = node.children.filter((c): c is El => typeof c !== "string");
		const total = textLen(node);
		const scored = kids.map((k) => ({ k, score: textLen(k) - 2 * linkLen(k) }));
		const best = scored.sort((a, b) => b.score - a.score)[0];
		if (!best || best.score < total * 0.6 || kids.length === 0) break;
		node = best.k;
	}
	return node;
}

function inline(el: El | string, base: string): string {
	if (typeof el === "string") return decodeEntities(el).replace(/\s+/g, " ");
	if (el.tag === "br") return "\n";
	if (el.tag === "img") return "";
	const inner = el.children.map((c) => inline(c, base)).join("");
	switch (el.tag) {
		case "a": {
			const text = inner.trim();
			const href = el.attrs.href;
			if (!text) return "";
			if (!href || /^(javascript|mailto|tel|data):|^#/i.test(href)) return text;
			try {
				return `[${text}](${new URL(href, base).toString()})`;
			} catch {
				return text;
			}
		}
		case "strong":
		case "b":
			return inner.trim() ? `**${inner.trim()}**` : "";
		case "em":
		case "i":
			return inner.trim() ? `*${inner.trim()}*` : "";
		case "code":
			return inner.trim() ? `\`${inner.trim()}\`` : "";
		default:
			return BLOCK.has(el.tag) || el.tag === "td" || el.tag === "th" ? ` ${inner} ` : inner;
	}
}

function table(el: El, base: string): string {
	const rows: string[][] = [];
	const walk = (e: El) => {
		for (const c of e.children) {
			if (typeof c === "string") continue;
			if (c.tag === "tr") rows.push(c.children.filter((x): x is El => typeof x !== "string" && (x.tag === "td" || x.tag === "th")).map((x) => inline(x, base).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()));
			else walk(c);
		}
	};
	walk(el);
	const width = Math.max(0, ...rows.map((r) => r.length));
	if (!rows.length || !width) return "";
	const pad = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
	return [pad(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(pad)].join("\n");
}

function blocks(el: El, base: string, out: string[], listDepth = 0, ordered = false, index = { n: 0 }): void {
	for (const c of el.children) {
		if (typeof c === "string") {
			const t = inline(c, base).trim();
			if (t) out.push(t);
			continue;
		}
		const tag = c.tag;
		if (/^h[1-6]$/.test(tag)) {
			const t = inline(c, base).replace(/\s+/g, " ").trim();
			if (t) out.push(`${"#".repeat(Number(tag[1]))} ${t}`);
		} else if (tag === "pre") {
			out.push(`\`\`\`\n${decodeEntities(textOf(c)).replace(/^\n+|\s+$/g, "")}\n\`\`\``);
		} else if (tag === "table") {
			const t = table(c, base);
			if (t) out.push(t);
		} else if (tag === "ul" || tag === "ol") {
			const sub: string[] = [];
			const counter = { n: 0 };
			blocks(c, base, sub, listDepth + 1, tag === "ol", counter);
			out.push(sub.join("\n"));
		} else if (tag === "li") {
			index.n += 1;
			const inlineParts: string[] = [];
			const nested: string[] = [];
			for (const k of c.children) {
				if (typeof k !== "string" && (k.tag === "ul" || k.tag === "ol")) blocks({ ...c, children: [k] }, base, nested, listDepth, false, { n: 0 });
				else inlineParts.push(inline(k, base));
			}
			const text = inlineParts.join("").replace(/\s+/g, " ").trim();
			const pad = "  ".repeat(Math.max(0, listDepth - 1));
			if (text) out.push(`${pad}${ordered ? `${index.n}.` : "-"} ${text}`);
			if (nested.length) out.push(nested.join("\n"));
		} else if (tag === "blockquote") {
			const sub: string[] = [];
			blocks(c, base, sub, listDepth);
			out.push(sub.join("\n\n").split("\n").map((l) => `> ${l}`).join("\n"));
		} else if (tag === "p" || tag === "figcaption" || tag === "dt" || tag === "dd" || tag === "summary") {
			const t = inline(c, base).replace(/[ \t]+/g, " ").trim();
			if (t) out.push(t);
		} else if (BLOCK.has(tag)) {
			if (c.children.every((k) => typeof k === "string" || !BLOCK.has(k.tag))) {
				const t = inline(c, base).replace(/[ \t]+/g, " ").trim();
				if (t) out.push(t);
			} else blocks(c, base, out, listDepth);
		} else {
			const t = inline(c, base).replace(/[ \t]+/g, " ").trim();
			if (t) out.push(t);
		}
	}
}

export interface HtmlExtract {
	title: string;
	markdown: string;
	author?: string;
	publishedDate?: string;
	words: number;
}

const meta = (head: El, test: (a: Record<string, string>) => boolean): string | undefined => find(head, (e) => e.tag === "meta" && test(e.attrs))?.attrs.content;

export function extractHtml(html: string, url: string): HtmlExtract {
	const tree = parseHtml(html);
	const htmlEl = find(tree, (e) => e.tag === "html") ?? tree;
	const headEl = find(htmlEl, (e) => e.tag === "head") ?? htmlEl;
	const body = find(htmlEl, (e) => e.tag === "body") ?? htmlEl;
	const title =
		meta(headEl, (a) => a.property === "og:title") ||
		decodeEntities(textOf(find(headEl, (e) => e.tag === "title") ?? "")).replace(/\s+/g, " ").trim() ||
		decodeEntities(textOf(find(body, (e) => e.tag === "h1") ?? "")).replace(/\s+/g, " ").trim();
	const author = meta(headEl, (a) => a.name === "author");
	const publishedDate = meta(headEl, (a) => a.property === "article:published_time" || a.name === "date") ?? find(body, (e) => e.tag === "time" && !!e.attrs.datetime)?.attrs.datetime;
	const main = mainOf(prune(body));
	const out: string[] = [];
	blocks(main, url, out);
	const markdown = out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
	return { title, markdown, author, publishedDate, words: markdown.split(/\s+/).filter(Boolean).length };
}
