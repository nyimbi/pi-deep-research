/**
 * Draws a simple Mermaid flowchart in the diagram-design skill's editorial style: paper and ink tokens,
 * one accent on the focal node, 6px-radius boxes with no shadows, orthogonal connectors with r=8 elbows,
 * masked all-caps arrow labels, and an accessible title and desc. It lays out layer by layer.
 *
 * It draws only what it can draw correctly and returns null otherwise (nested subgraphs, decisions, cycles, long
 * labels, an edge that would pass behind a box, a label that would not fit), so the caller falls back to
 * the Mermaid renderer instead of shipping a diagram that breaks the skill's connector rules.
 */
import { drawSequence } from "./diagram-sequence.ts";

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

interface GNode { pseudo?: "start" | "end"; group: string | null; id: string; label: string; store: boolean; layer: number; slot: number; m: number; c: number; msize: number; csize: number }
interface GEdge { back?: boolean; from: string; to: string; label: string; style: "solid" | "dotted" | "thick" | "line" }
type Seg = { a1: number; c1: number; a2: number; c2: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const snap = (n: number) => Math.ceil(n / 4) * 4;

const NODE = /([A-Za-z_]\w*)(?:\[\(\s*"?([^\]"]*?)"?\s*\)\]|\[\s*"?([^\]"]*?)"?\s*\]|\(\(\s*"?([^)"]*?)"?\s*\)\)|\(\s*"?([^)"]*?)"?\s*\))?/y;
const ARROW = /\s*(?:(-->|---|==>|-\.->)(?:\|([^|]*)\|)?|--\s+([^->|][^>]*?)\s+(-->|---)|==\s+([^=>|][^>]*?)\s+(==>)|-\.\s+([^.>|][^>]*?)\s+(\.->))\s*/y;

interface Group { id: string; title: string }

function parse(source: string): { dir: "LR" | "TD"; nodes: GNode[]; edges: GEdge[]; groups: Group[] } | null {
	const lines = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	const head = /^(?:flowchart|graph)\s+(LR|TD|TB)\s*;?$/.exec(lines[0] ?? "");
	if (!head) return null;
	const nodes = new Map<string, GNode>();
	const edges: GEdge[] = [];
	const groups: Group[] = [];
	const marked = new Set<number>();
	let open: Group | null = null;
	for (const line of lines.slice(1)) {
		const sub = /^subgraph\s+(?:([A-Za-z_]\w*)\s*\[\s*"?([^\]"]*?)"?\s*\]|"?([^"]+?)"?)\s*$/.exec(line);
		if (sub) {
			if (open) return null;
			const title = (sub[2] ?? sub[3]).trim();
			open = { id: sub[1] ?? title, title };
			if (groups.some((x) => x.id === open!.id)) return null;
			groups.push(open);
			continue;
		}
		if (/^end$/.test(line)) {
			if (!open) return null;
			open = null;
			continue;
		}
		const ls = /^linkStyle\s+(\d[\d,\s]*)\s+(.*)$/.exec(line);
		if (ls) {
			if (/stroke\s*:/.test(ls[2])) for (const i of ls[1].split(",")) marked.add(Number(i.trim()));
			continue;
		}
		if (/^(?:style|classDef|class|linkStyle|click|direction)\b/.test(line)) continue;
		if (/^subgraph\b|<br|&|:::/.test(line)) return null;
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
			} else nodes.set(n[1], { group: open?.id ?? null, id: n[1], label: label ?? n[1], store: n[2] !== undefined, layer: 0, slot: 0, m: 0, c: 0, msize: 0, csize: 0 });
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
	if (open || !edges.length || nodes.size < 2) return null;
	for (const i of marked) if (edges[i]) edges[i].style = "thick";
	return { dir: head[1] === "LR" ? "LR" : "TD", nodes: [...nodes.values()], edges, groups };
}

/** Marks back edges (they close a cycle) and sets longest-path layers over the rest. Returns a reason on refusal. */
function layer(nodes: GNode[], edges: GEdge[]): string | null {
	if (edges.some((e) => e.from === e.to)) return "an arrow from a node to itself";
	const state = new Map<string, 1 | 2>();
	const walk = (id: string) => {
		state.set(id, 1);
		for (const e of edges) {
			if (e.from !== id) continue;
			const st = state.get(e.to);
			if (st === 1) e.back = true;
			else if (!st) walk(e.to);
		}
		state.set(id, 2);
	};
	for (const n of nodes) if (!state.get(n.id)) walk(n.id);
	const memo = new Map<string, number>();
	const depth = (id: string): number => {
		const known = memo.get(id);
		if (known !== undefined) return known;
		const d = Math.max(-1, ...edges.filter((e) => !e.back && e.to === id).map((e) => depth(e.from))) + 1;
		memo.set(id, d);
		return d;
	};
	for (const n of nodes) n.layer = depth(n.id);
	return null;
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

interface Rect { x: number; y: number; w: number; h: number }
interface Block { w: number; h: number; paths: string[]; labelSvg: string[]; boxesSvg: string[]; kinds: Set<string>; focal: boolean; rects: Map<string, Rect> }
interface BlockOpts { focalOk: boolean; framed?: Map<string, number> }

const PSEUDO = 20;

/** Lays out one set of nodes in local coordinates, margin included. Back edges run in lanes beside the nodes. */
function layoutBlock(nodes: GNode[], edges: GEdge[], lr: boolean, skin: Skin, opts: BlockOpts): Block | null {
	const by = new Map(nodes.map((n) => [n.id, n]));
	const why = layer(nodes, edges);
	if (why) return bail(why);
	const fwd = edges.filter((e) => !e.back);
	const back = edges.filter((e) => e.back);
	const framed = opts.framed;
	const margin = framed ? 56 : MARGIN;
	const spacing = framed ? 56 : lr ? 32 : 40;
	for (const n of nodes) {
		const ins = fwd.filter((e) => e.to === n.id);
		const outs = fwd.filter((e) => e.from === n.id);
		if (n.pseudo) {
			if (ins.length + outs.length + back.filter((e) => e.from === n.id || e.to === n.id).length > 1) return bail("a start or end marker with more than one arrow");
			n.msize = PSEUDO;
			n.csize = PSEUDO;
			continue;
		}
		const w = Math.min(240, Math.max(112, snap(n.label.length * 7.2 + 32)));
		if (n.label.length * 7.2 + 32 > 240) return bail("node label too wide");
		// Room for every port: a label sits above (LR) or beside (TD) its connector, so incoming ports on one
		// edge need that much space between them; outgoing ports need the skill's 12px.
		const labelW = Math.max(0, ...ins.map((e) => e.label.length * 5.4 + 8));
		const need = Math.max(lr ? NODE_H : w, ins.length > 1 ? (lr ? 24 : labelW + 14) * (ins.length + 1) : 0, outs.length > 1 ? 12 * (outs.length + 1) : 0);
		n.msize = lr ? w : NODE_H;
		n.csize = Math.min(lr ? 240 : 320, snap(need));
	}
	// Order within each layer: appearance, then two barycenter sweeps; frames keep their members together.
	const depth = Math.max(...nodes.map((n) => n.layer));
	const layers: GNode[][] = Array.from({ length: depth + 1 }, (_, i) => nodes.filter((n) => n.layer === i));
	const reslot = () => layers.forEach((l) => l.forEach((n, i) => (n.slot = i)));
	const gi = (n: GNode) => framed?.get(n.id) ?? 0;
	reslot();
	for (let pass = 0; pass < 2; pass++) {
		const down = pass === 0;
		for (let i = down ? 1 : depth - 1; down ? i <= depth : i >= 0; i += down ? 1 : -1) {
			const score = (n: GNode) => {
				const near = fwd.filter((e) => (down ? e.to === n.id : e.from === n.id)).map((e) => by.get(down ? e.from : e.to)!.slot);
				return near.length ? near.reduce((a, b) => a + b, 0) / near.length : n.slot;
			};
			layers[i].sort((a, b) => gi(a) - gi(b) || score(a) - score(b));
			reslot();
		}
	}
	if (framed) {
		layers.forEach((l) => l.sort((a, b) => gi(a) - gi(b) || a.slot - b.slot));
		reslot();
	}
	// Main-axis gaps: wide enough for the longest label and one channel per edge leaving the layer.
	const leaving = (i: number) => fwd.filter((e) => by.get(e.from)!.layer === i).length;
	const gap = (i: number) => {
		const longest = Math.max(0, ...fwd.filter((e) => by.get(e.to)!.layer === i + 1).map((e) => e.label.length * 5.5 + 8));
		return snap(Math.max(lr ? 96 : 80, (lr ? longest + 32 : 64) + 12 * leaving(i)));
	};
	// Lanes for back edges sit before the first node on the cross axis; one pitch per lane.
	const backLabelW = Math.max(0, ...back.map((e) => e.label.length * 5.4 + 8));
	const pitch = lr ? 28 : Math.ceil(backLabelW) + 16;
	const lead = back.length ? pitch * back.length + (lr ? 20 : 8) : 0;
	const top = margin + lead;
	let m = margin;
	const layerM: number[] = [];
	const layerEnd: number[] = [];
	for (let i = 0; i <= depth; i++) {
		layerM[i] = m;
		const size = Math.max(...layers[i].map((n) => n.msize));
		layerEnd[i] = m + size;
		for (const n of layers[i]) n.m = m + (size - n.msize) / 2;
		m += size + (i < depth ? gap(i) : 0);
	}
	const spanOf = (l: GNode[]) => l.reduce((a, n) => a + n.csize, 0) + Math.max(0, l.length - 1) * spacing;
	let maxC: number;
	if (framed) {
		// Each subgraph owns one band across the whole cross axis, so frames cannot meet.
		const gids = [...new Set(nodes.map(gi))].sort((x, y) => x - y);
		const bands = gids.map((g) => Math.max(...layers.map((l) => spanOf(l.filter((n) => gi(n) === g)))));
		let start = top;
		gids.forEach((g, k) => {
			for (const l of layers) {
				const mine = l.filter((n) => gi(n) === g);
				let c = start + (bands[k] - spanOf(mine)) / 2;
				for (const n of mine) {
					n.c = snap(c);
					c += n.csize + spacing;
				}
			}
			start += bands[k] + spacing;
		});
		maxC = start - spacing - top;
	} else {
		const spanC = layers.map(spanOf);
		maxC = Math.max(...spanC);
		layers.forEach((l, i) => {
			let c = top + (maxC - spanC[i]) / 2;
			for (const n of l) {
				n.c = snap(c);
				c += n.csize + spacing;
			}
		});
	}
	const mainEnd = m + margin;
	const crossEnd = top + maxC + margin;

	// Ports: each connector on one box edge gets its own point at L*k/(N+1).
	const port = new Map<string, number>();
	const fan = (side: "out" | "in") => {
		for (const n of nodes) {
			const es = fwd.filter((e) => (side === "out" ? e.from : e.to) === n.id).sort((x, y) => by.get(side === "out" ? x.to : x.from)!.slot - by.get(side === "out" ? y.to : y.from)!.slot);
			es.forEach((e, k) => port.set(`${side}:${edges.indexOf(e)}`, Math.round((n.csize * (k + 1)) / (es.length + 1))));
		}
	};
	fan("out");
	fan("in");
	if ([...port.values()].some((p) => p < 8)) return bail("connector port within 8px of a corner");
	// A start or end marker lines up with the port it connects to, so the connector is a straight line.
	for (const [idx, e] of edges.entries()) {
		if (e.back) continue;
		const [pn, other, key, otherKey] = by.get(e.from)!.pseudo ? [by.get(e.from)!, by.get(e.to)!, `out:${idx}`, `in:${idx}`] : by.get(e.to)!.pseudo ? [by.get(e.to)!, by.get(e.from)!, `in:${idx}`, `out:${idx}`] : [null, null, "", ""];
		if (!pn || !other) continue;
		const want = other.c + port.get(otherKey)! - port.get(key)!;
		if (Math.abs(want - pn.c) <= 8) pn.c = want;
	}
	// Back-edge ends share the cross-min side of a node, fanned along the main axis.
	const topPort = new Map<string, number>();
	for (const n of nodes) {
		const ends = back.flatMap((e) => [...(e.from === n.id ? [{ e, side: "out", other: by.get(e.to)! }] : []), ...(e.to === n.id ? [{ e, side: "in", other: by.get(e.from)! }] : [])]).sort((x, y) => x.other.m - y.other.m);
		ends.forEach((x, k) => topPort.set(`${x.side}:${edges.indexOf(x.e)}`, Math.round((n.msize * (k + 1)) / (ends.length + 1))));
		if (ends.length > 1 && n.msize / (ends.length + 1) < 12) return bail("too many back arrows on one node");
	}

	const segs: Array<{ edge: number; seg: Seg }> = [];
	const paths: string[] = [];
	const labels: Array<{ edge: number; text: string; x: number; y: number; w: number }> = [];
	const used = new Map<number, number>();
	const px = (a: number, c: number) => (lr ? `${a} ${c}` : `${c} ${a}`);
	const hit = (s: Seg, n: GNode) => {
		const [a0, a1, c0, c1] = [Math.min(s.a1, s.a2), Math.max(s.a1, s.a2), Math.min(s.c1, s.c2), Math.max(s.c1, s.c2)];
		return a1 > n.m - 1 && a0 < n.m + n.msize + 1 && c1 > n.c - 1 && c0 < n.c + n.csize + 1;
	};
	const stroke = (e: GEdge, d: string) => {
		const color = e.style === "thick" ? skin.accent : skin.muted;
		const marker = e.style === "line" ? "" : ` marker-end="url(#${e.style === "thick" ? "arrow-accent" : "arrow"})"`;
		paths.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${e.style === "thick" ? 1.6 : 1.2}"${e.style === "dotted" ? ' stroke-dasharray="5,4"' : ""}${marker}/>`);
	};
	for (const [idx, e] of edges.entries()) {
		if (e.back) continue;
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
		stroke(e, d);
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
	// Back edges: out of the cross-min side of the source, along a lane, into the cross-min side of the target.
	// Shorter spans take the lane nearest the nodes; two spans that only partly overlap would have to cross.
	const spans = back.map((e) => {
		const x = by.get(e.from)!.m + topPort.get(`out:${edges.indexOf(e)}`)!;
		const y = by.get(e.to)!.m + topPort.get(`in:${edges.indexOf(e)}`)!;
		return { e, lo: Math.min(x, y), hi: Math.max(x, y) };
	});
	for (const p of spans) for (const q of spans) if (p !== q && p.lo < q.lo && q.lo < p.hi && p.hi < q.hi) return bail("two back arrows would cross");
	spans.sort((p, q) => p.hi - p.lo - (q.hi - q.lo));
	for (const [rank, { e }] of spans.entries()) {
		const idx = edges.indexOf(e);
		const s = by.get(e.from)!;
		const t = by.get(e.to)!;
		const lane = top - 16 - pitch * rank - (lr ? 0 : 0);
		const as = s.m + topPort.get(`out:${idx}`)!;
		const at = t.m + topPort.get(`in:${idx}`)!;
		const legs: Seg[] = [{ a1: as, c1: s.c, a2: as, c2: lane }, { a1: as, c1: lane, a2: at, c2: lane }, { a1: at, c1: lane, a2: at, c2: t.c }];
		if (nodes.some((n) => n !== s && hit(legs[0], n)) || nodes.some((n) => n !== t && hit(legs[2], n))) return bail("no route for a back arrow that avoids every other box");
		for (const seg of legs) segs.push({ edge: idx, seg });
		const sign = at > as ? 1 : -1;
		const r = Math.min(R, Math.abs(at - as) / 2);
		stroke(e, `M${px(as, s.c)} L${px(as, lane + r)} Q${px(as, lane)} ${px(as + sign * r, lane)} L${px(at - sign * r, lane)} Q${px(at, lane)} ${px(at, lane + r)} L${px(at, t.c)}`);
		if (e.label) {
			const w = Math.ceil(e.label.length * 5.4 + 8);
			if (Math.abs(at - as) < (lr ? w + 16 : 22)) return bail("label does not fit on its back arrow");
			const mid = (as + at) / 2;
			labels.push(lr ? { edge: idx, text: e.label, x: mid, y: lane - 13, w } : { edge: idx, text: e.label, x: lane - 8 - w / 2, y: mid, w });
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

	const real = nodes.filter((n) => !n.pseudo);
	const degree = (n: GNode) => edges.filter((e) => e.from === n.id || e.to === n.id).length;
	const hub = [...real].sort((a, b) => degree(b) - degree(a))[0];
	const focal = opts.focalOk && hub && degree(hub) >= 3 ? hub.id : null;
	const kinds = new Set<string>();
	const rects = new Map<string, Rect>();
	const boxesSvg = nodes.map((n) => {
		const [x, y, w, h] = lr ? [n.m, n.c, n.msize, n.csize] : [n.c, n.m, n.csize, n.msize];
		rects.set(n.id, { x, y, w, h });
		if (n.pseudo === "start") return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="8" fill="${skin.ink}"/>`;
		if (n.pseudo === "end") return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="9.5" fill="${skin.paper}" stroke="${skin.ink}" stroke-width="1.2"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="5.5" fill="${skin.ink}"/>`;
		const kind = n.id === focal ? "FOCAL" : n.store ? "STORE" : "STEP";
		kinds.add(kind);
		const [fill, stroke] = kind === "FOCAL" ? [skin.accentTint, skin.accent] : kind === "STORE" ? [skin.store, skin.muted] : [skin.node, skin.ink];
		return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${skin.paper}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" fill="${skin.ink}" font-size="12" font-weight="600" font-family="${SANS}" text-anchor="middle">${esc(n.label)}</text>`;
	});
	const labelSvg = labels.map((l) => `<rect x="${l.x - l.w / 2}" y="${l.y - 7}" width="${l.w}" height="14" rx="2" fill="${skin.paper}"/><text x="${l.x}" y="${l.y + 3}" fill="${skin.soft}" font-size="8" font-family="${MONO}" text-anchor="middle" letter-spacing="0.06em">${esc(l.text)}</text>`);
	return { w: lr ? mainEnd : crossEnd, h: lr ? crossEnd : mainEnd, paths, labelSvg, boxesSvg, kinds, focal: focal !== null, rects };
}

function sequenceDiagram(source: string, opts: { slug: string; title: string; desc: string; skin?: Skin }): StyledDiagram | null {
	const r = drawSequence(source, opts.skin ?? LIGHT, opts);
	return typeof r === "string" ? bail(r) : r;
}

/** A flowchart or state diagram in the common model, or null with a refusal reason set. */
function model(source: string): { dir: "LR" | "TD"; nodes: GNode[]; edges: GEdge[]; groups: Group[]; kind: string } | null {
	const first = source.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%%")) ?? "";
	if (/^stateDiagram(?:-v2)?\s*$/.test(first)) {
		const st = parseState(source);
		return st ? { ...st, groups: [], kind: "State" } : null;
	}
	const fc = parse(source);
	return fc ? { ...fc, kind: "Flowchart" } : null;
}

function parseState(source: string): { dir: "LR" | "TD"; nodes: GNode[]; edges: GEdge[] } | null {
	const lines = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	const nodes = new Map<string, GNode>();
	const edges: GEdge[] = [];
	let dir: "LR" | "TD" = "TD";
	let ends = 0;
	const state = (id: string, side: "from" | "to"): string => {
		if (id === "[*]") {
			const pid = side === "from" ? "__start" : `__end${++ends}`;
			if (!nodes.has(pid)) nodes.set(pid, { pseudo: side === "from" ? "start" : "end", group: null, id: pid, label: "", store: false, layer: 0, slot: 0, m: 0, c: 0, msize: 0, csize: 0 });
			return pid;
		}
		if (!nodes.has(id)) nodes.set(id, { group: null, id, label: id, store: false, layer: 0, slot: 0, m: 0, c: 0, msize: 0, csize: 0 });
		return id;
	};
	for (const line of lines.slice(1)) {
		const d = /^direction\s+(LR|TB|TD)$/.exec(line);
		if (d) {
			dir = d[1] === "LR" ? "LR" : "TD";
			continue;
		}
		const named = /^state\s+"([^"]+)"\s+as\s+([A-Za-z_]\w*)$/.exec(line);
		if (named) {
			state(named[2], "to");
			nodes.get(named[2])!.label = named[1].trim();
			continue;
		}
		const t = /^(\[\*\]|[A-Za-z_]\w*)\s*-->\s*(\[\*\]|[A-Za-z_]\w*)(?:\s*:\s*(.+))?$/.exec(line);
		if (!t || (t[1] === "[*]" && t[2] === "[*]")) return null;
		const from = state(t[1], "from");
		const to = state(t[2], "to");
		edges.push({ from, to, label: (t[3] ?? "").trim(), style: "solid" });
	}
	if (!edges.length) return null;
	return { dir, nodes: [...nodes.values()], edges };
}

export function editorialSvg(source: string, opts: { slug: string; title: string; desc: string; skin?: Skin }): StyledDiagram | null {
	refusal = null;
	if (/^\s*(?:%%[^\n]*\n\s*)*sequenceDiagram\b/.test(source)) return sequenceDiagram(source, opts);
	const g = model(source);
	if (!g) return bail("not a diagram this drawer reads (nested subgraph, decision, composite state, chained & or similar)");
	const skin = opts.skin ?? LIGHT;
	const { dir, nodes, edges, groups } = g;
	if (nodes.filter((n) => !n.pseudo).length > 9 || edges.length > 12) return bail("over 9 nodes or 12 arrows");
	const lr = dir === "LR";
	const group = new Map(nodes.map((n) => [n.id, n.group]));
	for (const e of edges) {
		if (e.label.length > LABEL_MAX) return bail("label over 14 characters");
		e.label = e.label.toUpperCase();
	}
	const accentArrows = edges.filter((e) => e.style === "thick").length;
	if (accentArrows > 2) return bail("more than 2 accent arrows");
	const crossing = edges.some((e) => group.get(e.from) !== group.get(e.to));
	const frames: Array<{ id: string | null; title: string | null }> = [...(nodes.some((n) => n.group === null) ? [{ id: null, title: null }] : []), ...groups];
	let focalLeft = 2 - accentArrows;
	const placed: Array<{ title: string | null; b: Block; bw: number }> = [];
	if (crossing) {
		// One layout for everything, then a frame around each subgraph's members. Frames may not overlap
		// each other or swallow a node that is not theirs.
		const order = new Map(nodes.map((n) => [n.id, groups.findIndex((x) => x.id === n.group)]));
		const b = layoutBlock(nodes, edges, lr, skin, { focalOk: focalLeft > 0, framed: order });
		if (!b) return null;
		const boxes = groups.map((gr) => {
			const rs = nodes.filter((n) => n.group === gr.id).map((n) => b.rects.get(n.id)!);
			if (!rs.length) return null;
			const x0 = Math.min(...rs.map((r) => r.x)) - 16;
			const y0 = Math.min(...rs.map((r) => r.y)) - 16 - 20;
			const x1 = Math.max(Math.max(...rs.map((r) => r.x + r.w)) + 16, x0 + Math.ceil(gr.title.length * 6.4 + 56));
			const y1 = Math.max(...rs.map((r) => r.y + r.h)) + 16;
			return { gr, x0, y0, x1, y1 };
		}).filter((x): x is NonNullable<typeof x> => x !== null);
		const meets = (p: { x0: number; y0: number; x1: number; y1: number }, q: { x0: number; y0: number; x1: number; y1: number }) => p.x1 > q.x0 && p.x0 < q.x1 && p.y1 > q.y0 && p.y0 < q.y1;
		for (const [i, f] of boxes.entries()) {
			for (const q of boxes.slice(i + 1)) if (meets(f, q)) return bail("subgraph frames would overlap");
			for (const n of nodes) if (n.group !== f.gr.id && meets(f, { x0: b.rects.get(n.id)!.x, y0: b.rects.get(n.id)!.y, x1: b.rects.get(n.id)!.x + b.rects.get(n.id)!.w, y1: b.rects.get(n.id)!.y + b.rects.get(n.id)!.h })) return bail("a subgraph frame would swallow another node");
		}
		const frameSvg = boxes.map((f) => `<rect x="${f.x0}" y="${f.y0 + 8}" width="${f.x1 - f.x0}" height="${f.y1 - f.y0 - 8}" rx="6" fill="none" stroke="${skin.muted}" stroke-opacity="0.35" stroke-width="1"/><text x="${f.x0 + 16}" y="${f.y0 + 28}" fill="${skin.muted}" font-size="9" font-family="${MONO}" letter-spacing="0.12em">${esc(f.gr.title.toUpperCase())}</text>`);
		placed.push({ title: null, b: { ...b, paths: [...frameSvg, ...b.paths] }, bw: b.w });
	} else {
		for (const f of frames) {
			const ns = nodes.filter((n) => n.group === f.id);
			if (!ns.length) continue;
			const ids = new Set(ns.map((n) => n.id));
			const b = layoutBlock(ns, edges.filter((e) => ids.has(e.from)), lr, skin, { focalOk: focalLeft > 0 });
			if (!b) return null;
			if (b.focal) focalLeft--;
			placed.push({ title: f.title?.toUpperCase() ?? null, b, bw: Math.max(b.w, f.title ? snap(f.title.length * 6.4 + 56) : 0) });
		}
	}
	const BAND = 20;
	const flo = (n: number) => Math.floor(n / 4) * 4;
	const total = lr ? Math.max(...placed.map((p) => p.bw)) : placed.reduce((a, p) => a + p.bw, 0);
	const width = Math.max(960, snap(total));
	const parts: string[] = [];
	const kinds = new Set<string>();
	let cursor = lr ? 0 : flo((width - total) / 2);
	let body = 0;
	for (const p of placed) {
		const band = p.title ? BAND : 0;
		const fx = lr ? flo((width - p.bw) / 2) : cursor;
		const fy = lr ? cursor : 0;
		const ox = fx + flo((p.bw - p.b.w) / 2);
		if (p.title) {
			parts.push(`<rect x="${fx + 12}" y="${fy + 8}" width="${p.bw - 24}" height="${band + p.b.h - 12}" rx="6" fill="none" stroke="${skin.muted}" stroke-opacity="0.35" stroke-width="1"/>`);
			parts.push(`<text x="${fx + 28}" y="${fy + 28}" fill="${skin.muted}" font-size="9" font-family="${MONO}" letter-spacing="0.12em">${esc(p.title)}</text>`);
		}
		parts.push(`<g transform="translate(${ox} ${fy + band})">`, ...p.b.paths, ...p.b.labelSvg, ...p.b.boxesSvg, "</g>");
		for (const k of p.b.kinds) kinds.add(k);
		body = lr ? fy + band + p.b.h : Math.max(body, band + p.b.h);
		cursor += lr ? band + p.b.h : p.bw;
	}
	const legend = kinds.size > 1;
	const height = snap(body + (legend ? 60 : 0));
	const legendSvg = legend
		? `<line x1="30" y1="${body}" x2="${width - 30}" y2="${body}" stroke="${skin.rule}" stroke-width="0.8"/><text x="30" y="${body + 20}" fill="${skin.muted}" font-size="8" font-family="${MONO}" letter-spacing="0.14em">LEGEND</text>` +
			[...kinds].map((k, i) => {
				const [fill, stroke] = k === "FOCAL" ? [skin.accentTint, skin.accent] : k === "STORE" ? [skin.store, skin.muted] : [skin.node, skin.ink];
				return `<rect x="${100 + i * 160}" y="${body + 11}" width="16" height="12" rx="2" fill="${fill}" stroke="${stroke}"/><text x="${124 + i * 160}" y="${body + 20}" fill="${skin.soft}" font-size="8" font-family="${MONO}" letter-spacing="0.08em">${k}</text>`;
			}).join("")
		: "";
	const svg = [
		`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${opts.slug}-title ${opts.slug}-desc">`,
		`<title id="${opts.slug}-title">${esc(opts.title)}</title>`,
		`<desc id="${opts.slug}-desc">${esc(opts.desc)}</desc>`,
		`<defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${skin.muted}"/></marker><marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${skin.accent}"/></marker></defs>`,
		`<rect width="100%" height="100%" fill="${skin.paper}"/>`,
		...parts,
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
export interface Styled { svg: string; html: string }

function styleWith(source: string, ctx: { index: number; caption: string | undefined }, skin: Skin): Styled | { refused: string } {
	const sequence = /^\s*(?:%%[^\n]*\n\s*)*sequenceDiagram\b/.test(source);
	const g = sequence ? null : model(source);
	const kind = sequence ? "Sequence" : (g?.kind ?? "Diagram");
	const names = sequence ? [...source.matchAll(/^\s*(?:participant|actor)\s+\S+(?:\s+as\s+(.+))?$/gm)].map((m) => m[1]).filter(Boolean).join(", ") : (g?.nodes.filter((n) => !n.pseudo).map((n) => n.label).join(", ") ?? "");
	const desc = (ctx.caption ?? `${kind} diagram${names ? ` of ${names}` : ""}.`).replace(/\s+/g, " ").trim();
	const title = desc.length <= 60 ? desc.replace(/[.!]$/, "") : `${desc.slice(0, 57).replace(/\s+\S*$/, "")}...`;
	const styled = editorialSvg(source, { slug: `diagram-${ctx.index}`, title, desc, skin });
	if (!styled) return { refused: refusal ?? "not a diagram this drawer reads" };
	return { svg: styled.svg, html: editorialPage(styled, { title, eyebrow: `${kind} · Diagram Design`, skin }) };
}

/** The package hook: light drawing plus the same drawing in the skill's dark skin. Title and desc come from the caption sentence. */
export function styleForPackage(source: string, ctx: { index: number; caption: string | undefined }): (Styled & { dark: Styled }) | { refused: string } {
	const light = styleWith(source, ctx, LIGHT);
	if ("refused" in light) return light;
	const dark = styleWith(source, ctx, DARK);
	if ("refused" in dark) return { refused: `dark skin: ${dark.refused}` };
	return { ...light, dark };
}
