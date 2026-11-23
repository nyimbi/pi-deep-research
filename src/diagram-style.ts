/**
 * Draws a simple Mermaid flowchart in the diagram-design skill's editorial style: paper and ink tokens,
 * one accent on the focal node, 6px-radius boxes with no shadows, orthogonal connectors with r=8 elbows,
 * masked all-caps arrow labels, and an accessible title and desc. It lays out layer by layer.
 *
 * It draws only what it can draw correctly and returns null otherwise (subgraphs, decisions, cycles, long
 * labels, an edge that would pass behind a box, a label that would not fit), so the caller falls back to
 * the Mermaid renderer instead of shipping a diagram that breaks the skill's connector rules.
 */
export interface Skin {
	paper: string;
	ink: string;
	muted: string;
	soft: string;
	accent: string;
	accentTint: string;
	node: string;
	store: string;
	rule: string;
}

export const LIGHT: Skin = { paper: "#f5f5f5", ink: "#2d3142", muted: "#4f5d75", soft: "#5a6580", accent: "#bf4520", accentTint: "rgba(191,69,32,0.08)", node: "#ffffff", store: "rgba(45,49,66,0.05)", rule: "rgba(45,49,66,0.10)" };
export const DARK: Skin = { paper: "#2d3142", ink: "#f5f5f5", muted: "#bfc0c0", soft: "#949eb2", accent: "#f08a59", accentTint: "rgba(240,138,89,0.10)", node: "#393e53", store: "rgba(245,245,245,0.05)", rule: "rgba(245,245,245,0.10)" };

const SANS = "Geist, system-ui, sans-serif";
const MONO = "'Geist Mono', ui-monospace, monospace";
const NODE_H = 48;
const LABEL_MAX = 14;
const R = 8;
const MARGIN = 32;

interface GNode { id: string; label: string; store: boolean; layer: number; slot: number; m: number; c: number; msize: number; csize: number }
interface GEdge { from: string; to: string; label: string; style: "solid" | "dotted" | "thick" | "line" }
type Seg = { a1: number; c1: number; a2: number; c2: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const snap = (n: number) => Math.ceil(n / 4) * 4;

const NODE = /([A-Za-z_][\w-]*)(?:\[\(\s*"?([^\]"]*?)"?\s*\)\]|\[\s*"?([^\]"]*?)"?\s*\]|\(\(\s*"?([^)"]*?)"?\s*\)\)|\(\s*"?([^)"]*?)"?\s*\))?/y;
const ARROW = /\s*(?:(-->|---|==>|-\.->)(?:\|([^|]*)\|)?|--\s+([^->|][^>]*?)\s+(-->|---)|==\s+([^=>|][^>]*?)\s+(==>)|-\.\s+([^.>|][^>]*?)\s+(\.->))\s*/y;

function parse(source: string): { dir: "LR" | "TD"; nodes: GNode[]; edges: GEdge[] } | null {
	const lines = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	const head = /^(?:flowchart|graph)\s+(LR|TD|TB)\s*;?$/.exec(lines[0] ?? "");
	if (!head) return null;
	const nodes = new Map<string, GNode>();
	const edges: GEdge[] = [];
	for (const line of lines.slice(1)) {
		if (/^(?:style|classDef|class|linkStyle|click|direction)\b/.test(line)) continue;
		if (/^(?:subgraph|end)\b|<br|&|:::/.test(line)) return null;
		const ids: string[] = [];
		const arrows: Array<Pick<GEdge, "label" | "style">> = [];
		let pos = 0;
		for (;;) {
			NODE.lastIndex = pos;
			const n = NODE.exec(line);
			if (!n) return null;
			const label = (n[2] ?? n[3] ?? n[4] ?? n[5])?.trim();
			const known = nodes.get(n[1]);
			if (known) {
				if (label !== undefined) known.label = label;
			} else nodes.set(n[1], { id: n[1], label: label ?? n[1], store: n[2] !== undefined, layer: 0, slot: 0, m: 0, c: 0, msize: 0, csize: 0 });
			if (n[2] !== undefined && known) known.store = true;
			ids.push(n[1]);
			pos = NODE.lastIndex;
			if (pos >= line.length) break;
			ARROW.lastIndex = pos;
			const a = ARROW.exec(line);
			if (!a) return null;
			const op = a[1] ?? a[4] ?? a[6] ?? a[8];
			arrows.push({ label: (a[2] ?? a[3] ?? a[5] ?? a[7] ?? "").trim(), style: op === "-.->" || op === ".->" ? "dotted" : op === "==>" ? "thick" : op === "---" ? "line" : "solid" });
			pos = ARROW.lastIndex;
			if (pos >= line.length) return null;
		}
		arrows.forEach((a, i) => edges.push({ from: ids[i], to: ids[i + 1], ...a }));
	}
	if (!edges.length || nodes.size < 2) return null;
	return { dir: head[1] === "LR" ? "LR" : "TD", nodes: [...nodes.values()], edges };
}

/** Longest-path layers, or null on a cycle or self-loop. */
function layer(nodes: GNode[], edges: GEdge[]): boolean {
	const by = new Map(nodes.map((n) => [n.id, n]));
	const state = new Map<string, 0 | 1 | 2>();
	let cyclic = false;
	const visit = (id: string) => {
		if (state.get(id) === 2) return;
		if (state.get(id) === 1) {
			cyclic = true;
			return;
		}
		state.set(id, 1);
		for (const e of edges) if (e.to === id) visit(e.from);
		state.set(id, 2);
		const n = by.get(id)!;
		n.layer = Math.max(0, ...edges.filter((e) => e.to === id).map((e) => by.get(e.from)!.layer + 1));
	};
	for (const n of nodes) visit(n.id);
	return !cyclic && edges.every((e) => e.from !== e.to);
}

let refusal: string | null = null;
const bail = (why: string): null => {
	refusal = why;
	return null;
};
/** Why the last editorialSvg call returned null. */
export const styleRefusal = (): string | null => refusal;

export interface StyledDiagram {
	svg: string;
	width: number;
	height: number;
}

export function editorialSvg(source: string, opts: { slug: string; title: string; desc: string; skin?: Skin }): StyledDiagram | null {
	refusal = null;
	const g = parse(source);
	if (!g) return bail("not a flowchart this drawer reads (subgraph, decision, chained & or similar)");
	const skin = opts.skin ?? LIGHT;
	const { dir, nodes, edges } = g;
	if (nodes.length > 9 || edges.length > 12 || !layer(nodes, edges)) return bail("over 9 nodes or 12 arrows, or a cycle");
	const lr = dir === "LR";
	const by = new Map(nodes.map((n) => [n.id, n]));
	for (const e of edges) {
		if (e.label.length > LABEL_MAX) return bail("label over 14 characters");
		e.label = e.label.toUpperCase();
	}
	for (const n of nodes) {
		const w = Math.min(240, Math.max(112, snap(n.label.length * 7.2 + 32)));
		if (n.label.length * 7.2 + 32 > 240) return bail("node label too wide");
		// Room for every port: a label sits above (LR) or beside (TD) its connector, so incoming ports on one
		// edge need that much space between them; outgoing ports need the skill's 12px.
		const ins = edges.filter((e) => e.to === n.id);
		const outs = edges.filter((e) => e.from === n.id);
		const labelW = Math.max(0, ...ins.map((e) => e.label.length * 5.4 + 8));
		const need = Math.max(lr ? NODE_H : w, ins.length > 1 ? (lr ? 24 : labelW + 14) * (ins.length + 1) : 0, outs.length > 1 ? 12 * (outs.length + 1) : 0);
		n.msize = lr ? w : NODE_H;
		n.csize = Math.min(lr ? 240 : 320, snap(need));
	}
	// Order within each layer: appearance, then two barycenter sweeps.
	const depth = Math.max(...nodes.map((n) => n.layer));
	const layers: GNode[][] = Array.from({ length: depth + 1 }, (_, i) => nodes.filter((n) => n.layer === i));
	const reslot = () => layers.forEach((l) => l.forEach((n, i) => (n.slot = i)));
	reslot();
	for (let pass = 0; pass < 2; pass++) {
		const down = pass === 0;
		for (let i = down ? 1 : depth - 1; down ? i <= depth : i >= 0; i += down ? 1 : -1) {
			const score = (n: GNode) => {
				const near = edges.filter((e) => (down ? e.to === n.id : e.from === n.id)).map((e) => by.get(down ? e.from : e.to)!.slot);
				return near.length ? near.reduce((a, b) => a + b, 0) / near.length : n.slot;
			};
			layers[i].sort((a, b) => score(a) - score(b));
			reslot();
		}
	}
	// Main-axis gaps: wide enough for the longest label and one channel per edge leaving the layer.
	const leaving = (i: number) => edges.filter((e) => by.get(e.from)!.layer === i);
	const gap = (i: number) => {
		const longest = Math.max(0, ...edges.filter((e) => by.get(e.to)!.layer === i + 1).map((e) => e.label.length * 5.5 + 8));
		return snap(Math.max(lr ? 96 : 80, (lr ? longest + 32 : 64) + 12 * leaving(i).length));
	};
	let m = MARGIN;
	const layerM: number[] = [];
	const layerEnd: number[] = [];
	for (let i = 0; i <= depth; i++) {
		layerM[i] = m;
		const size = Math.max(...layers[i].map((n) => n.msize));
		layerEnd[i] = m + size;
		for (const n of layers[i]) n.m = m + (size - n.msize) / 2;
		m += size + (i < depth ? gap(i) : 0);
	}
	const spanC = layers.map((l) => l.reduce((a, n) => a + n.csize, 0) + (l.length - 1) * (lr ? 32 : 40));
	const maxC = Math.max(...spanC);
	layers.forEach((l, i) => {
		let c = MARGIN + (maxC - spanC[i]) / 2;
		for (const n of l) {
			n.c = snap(c);
			c += n.csize + (lr ? 32 : 40);
		}
	});
	const mainEnd = m + MARGIN;
	const crossEnd = MARGIN * 2 + maxC;

	// Ports: each connector on one box edge gets its own point at L*k/(N+1).
	const port = new Map<string, number>();
	const fan = (side: "out" | "in") => {
		for (const n of nodes) {
			const es = edges.filter((e) => (side === "out" ? e.from : e.to) === n.id).sort((x, y) => by.get(side === "out" ? x.to : x.from)!.slot - by.get(side === "out" ? y.to : y.from)!.slot);
			es.forEach((e, k) => port.set(`${side}:${edges.indexOf(e)}`, Math.round((n.csize * (k + 1)) / (es.length + 1))));
		}
	};
	fan("out");
	fan("in");
	if ([...port.values()].some((p) => p < 8)) return bail("connector port within 8px of a corner");

	const segs: Array<{ edge: number; seg: Seg }> = [];
	const paths: string[] = [];
	const labels: Array<{ edge: number; text: string; x: number; y: number; w: number }> = [];
	const used = new Map<number, number>();
	const px = (a: number, c: number) => (lr ? `${a} ${c}` : `${c} ${a}`);
	const hit = (s: Seg, n: GNode) => {
		const [a0, a1, c0, c1] = [Math.min(s.a1, s.a2), Math.max(s.a1, s.a2), Math.min(s.c1, s.c2), Math.max(s.c1, s.c2)];
		return a1 > n.m - 1 && a0 < n.m + n.msize + 1 && c1 > n.c - 1 && c0 < n.c + n.csize + 1;
	};
	for (const [idx, e] of edges.entries()) {
		const s = by.get(e.from)!;
		const t = by.get(e.to)!;
		const a1 = s.m + s.msize;
		const c1 = s.c + port.get(`out:${idx}`)!;
		const a2 = t.m;
		const c2 = t.c + port.get(`in:${idx}`)!;
		const others = nodes.filter((n) => n !== s && n !== t);
		const channels = [layerEnd[s.layer] + 16 + 12 * (used.get(s.layer) ?? 0), a2 - 16 - 12 * (used.get(-t.layer) ?? 0)];
		let chosen: { ac: number; list: Seg[] } | null = null;
		for (const [which, ac] of channels.entries()) {
			if (c1 === c2) {
				const list = [{ a1, c1, a2, c2 }];
				if (!others.some((n) => hit(list[0], n))) chosen = { ac: a1, list };
				break;
			}
			// Option 0 runs the long leg at the target's cross position; option 1 at the source's.
			const list: Seg[] = [{ a1, c1, a2: ac, c2: c1 }, { a1: ac, c1, a2: ac, c2 }, { a1: ac, c1: c2, a2, c2 }];
			if (which === 1 && t.layer - s.layer === 1) continue;
			if (!list.some((seg) => others.some((n) => hit(seg, n)))) {
				chosen = { ac, list };
				used.set(which === 0 ? s.layer : -t.layer, (used.get(which === 0 ? s.layer : -t.layer) ?? 0) + 1);
				break;
			}
		}
		if (!chosen) return bail("no route that avoids every other box");
		const { ac, list } = chosen;
		for (const seg of list) segs.push({ edge: idx, seg });
		let d: string;
		if (c1 === c2) d = `M${px(a1, c1)} L${px(a2, c2)}`;
		else {
			const r = Math.min(R, Math.abs(c2 - c1) / 2);
			const sign = c2 > c1 ? 1 : -1;
			d = `M${px(a1, c1)} L${px(ac - r, c1)} Q${px(ac, c1)} ${px(ac, c1 + sign * r)} L${px(ac, c2 - sign * r)} Q${px(ac, c2)} ${px(ac + r, c2)} L${px(a2, c2)}`;
		}
		const color = e.style === "thick" ? skin.accent : skin.muted;
		const marker = e.style === "line" ? "" : ` marker-end="url(#${e.style === "thick" ? "arrow-accent" : "arrow"})"`;
		paths.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${e.style === "thick" ? 1.6 : 1.2}"${e.style === "dotted" ? ' stroke-dasharray="5,4"' : ""}${marker}/>`);
		if (e.label) {
			const text = e.label;
			const w = Math.ceil(text.length * 5.4 + 8);
			const segLen = a2 - (c1 === c2 ? a1 : ac);
			if (segLen < (lr ? w + 16 : 22)) return bail("label does not fit on its segment");
			// Near the target, past every channel in the gap, so no other connector runs through it.
			const mid = lr ? a2 - 12 - w / 2 : a2 - 20;
			labels.push(lr ? { edge: idx, text, x: mid, y: c2 - 13, w } : { edge: idx, text, x: c2 - 6 - w / 2 - 4, y: mid, w });
		}
	}
	// Labels may not cover a box, another connector or another label (the skill's rules 2, 3 and 6).
	const boxes = labels.map((l) => ({ x0: l.x - l.w / 2, x1: l.x + l.w / 2, y0: l.y - 7, y1: l.y + 7 }));
	for (const [i, b] of boxes.entries()) {
		const own = labels[i].edge;
		for (const n of nodes) {
			const [nx, ny, nw, nh] = lr ? [n.m, n.c, n.msize, n.csize] : [n.c, n.m, n.csize, n.msize];
			if (b.x1 > nx && b.x0 < nx + nw && b.y1 > ny && b.y0 < ny + nh) return bail("a label would cover a box");
		}
		for (const { edge, seg } of segs) {
			if (edge === own) continue;
			const [x0, x1, y0, y1] = lr ? [Math.min(seg.a1, seg.a2), Math.max(seg.a1, seg.a2), Math.min(seg.c1, seg.c2), Math.max(seg.c1, seg.c2)] : [Math.min(seg.c1, seg.c2), Math.max(seg.c1, seg.c2), Math.min(seg.a1, seg.a2), Math.max(seg.a1, seg.a2)];
			if (b.x1 > x0 - 1 && b.x0 < x1 + 1 && b.y1 > y0 - 1 && b.y0 < y1 + 1) return bail("a label would cover a connector");
		}
		for (let j = i + 1; j < boxes.length; j++) if (b.x1 > boxes[j].x0 && b.x0 < boxes[j].x1 && b.y1 > boxes[j].y0 && b.y0 < boxes[j].y1) return bail("a label would cover another label");
	}

	const degree = (n: GNode) => edges.filter((e) => e.from === n.id || e.to === n.id).length;
	const hub = [...nodes].sort((a, b) => degree(b) - degree(a))[0];
	const focal = degree(hub) >= 3 ? hub.id : null;
	const kinds = new Set<string>();
	const boxesSvg = nodes.map((n) => {
		const [x, y, w, h] = lr ? [n.m, n.c, n.msize, n.csize] : [n.c, n.m, n.csize, n.msize];
		const kind = n.id === focal ? "FOCAL" : n.store ? "STORE" : "STEP";
		kinds.add(kind);
		const [fill, stroke] = kind === "FOCAL" ? [skin.accentTint, skin.accent] : kind === "STORE" ? [skin.store, skin.muted] : [skin.node, skin.ink];
		return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${skin.paper}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" fill="${skin.ink}" font-size="12" font-weight="600" font-family="${SANS}" text-anchor="middle">${esc(n.label)}</text>`;
	});
	const width = Math.max(960, snap(lr ? mainEnd : crossEnd));
	const body = lr ? crossEnd : mainEnd;
	const dx = Math.floor(Math.max(0, (width - (lr ? mainEnd : crossEnd)) / 2) / 4) * 4;
	const legend = kinds.size > 1;
	const height = snap(body + (legend ? 60 : 0));
	const legendSvg = legend
		? `<line x1="30" y1="${body}" x2="${width - 30}" y2="${body}" stroke="${skin.rule}" stroke-width="0.8"/><text x="30" y="${body + 20}" fill="${skin.muted}" font-size="8" font-family="${MONO}" letter-spacing="0.14em">LEGEND</text>` +
			[...kinds].map((k, i) => {
				const [fill, stroke] = k === "FOCAL" ? [skin.accentTint, skin.accent] : k === "STORE" ? [skin.store, skin.muted] : [skin.node, skin.ink];
				return `<rect x="${100 + i * 160}" y="${body + 11}" width="16" height="12" rx="2" fill="${fill}" stroke="${stroke}"/><text x="${124 + i * 160}" y="${body + 20}" fill="${skin.soft}" font-size="8" font-family="${MONO}" letter-spacing="0.08em">${k}</text>`;
			}).join("")
		: "";
	const labelSvg = labels.map((l) => `<rect x="${l.x - l.w / 2}" y="${l.y - 7}" width="${l.w}" height="14" rx="2" fill="${skin.paper}"/><text x="${l.x}" y="${l.y + 3}" fill="${skin.soft}" font-size="8" font-family="${MONO}" text-anchor="middle" letter-spacing="0.06em">${esc(l.text)}</text>`);
	const svg = [
		`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${opts.slug}-title ${opts.slug}-desc">`,
		`<title id="${opts.slug}-title">${esc(opts.title)}</title>`,
		`<desc id="${opts.slug}-desc">${esc(opts.desc)}</desc>`,
		`<defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${skin.muted}"/></marker><marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${skin.accent}"/></marker></defs>`,
		`<rect width="100%" height="100%" fill="${skin.paper}"/>`,
		dx > 0 ? `<g transform="translate(${dx} 0)">` : "",
		...paths,
		...labelSvg,
		...boxesSvg,
		dx > 0 ? "</g>" : "",
		legendSvg,
		"</svg>",
	].join("\n");
	return { svg, width, height };
}

/** A self-contained page in the skill's template shape: fonts link, paper ground, local scroller for narrow screens. */
export function editorialPage(styled: StyledDiagram, opts: { title: string; eyebrow: string; skin?: Skin }): string {
	const skin = opts.skin ?? LIGHT;
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(opts.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: ${SANS}; background: ${skin.paper}; color: ${skin.ink}; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3rem 2rem; }
.frame { max-width: 1200px; width: 100%; }
.diagram-container { width: 100%; overflow-x: auto; }
.eyebrow { font-family: ${MONO}; font-size: 0.66rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: ${skin.muted}; margin-bottom: 0.5rem; }
h1 { font-family: 'Instrument Serif', serif; font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 400; letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 1.5rem; }
svg { width: 100%; min-width: ${styled.width}px; display: block; }
@media print { .diagram-container { overflow-x: visible; } svg { min-width: 0; } }
</style>
</head>
<body>
<div class="frame">
<p class="eyebrow">${esc(opts.eyebrow)}</p>
<h1>${esc(opts.title)}</h1>
<div class="diagram-container">
${styled.svg}
</div>
</div>
</body>
</html>
`;
}

/** The package hook: title and desc come from the report's caption sentence, or from the node labels when there is none. */
export function styleForPackage(source: string, ctx: { index: number; caption: string | undefined }): { svg: string; html: string } | { refused: string } {
	const g = parse(source);
	const labels = g ? g.nodes.map((n) => n.label).join(", ") : "";
	const desc = (ctx.caption ?? `Flowchart of ${labels}.`).replace(/\s+/g, " ").trim();
	const title = desc.length <= 60 ? desc.replace(/[.!]$/, "") : `${desc.slice(0, 57).replace(/\s+\S*$/, "")}...`;
	const styled = editorialSvg(source, { slug: `diagram-${ctx.index}`, title, desc });
	if (!styled) return { refused: refusal ?? "not a simple flowchart" };
	return { svg: styled.svg, html: editorialPage(styled, { title, eyebrow: "Flowchart · Diagram Design" }) };
}
