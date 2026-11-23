/**
 * Draws a Mermaid sequenceDiagram in the diagram-design skill's style: participant boxes in a row, dashed
 * lifelines, horizontal messages (solid filled for a call, dashed filled for a return, dashed open for async),
 * each label centred above its line on a mask 6 to 10px clear of the stroke. Returns a reason string when it
 * cannot draw the diagram correctly: fragments, notes, activations, self-messages, more than five lifelines.
 */
import type { Skin } from "./diagram-style.ts";

const SANS = "Geist, system-ui, sans-serif";
const MONO = "'Geist Mono', ui-monospace, monospace";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const snap = (n: number) => Math.ceil(n / 4) * 4;
const LABEL_MAX = 28;
const ARROWS = { "->>": "call", "-->>": "return", "-)": "async", "--)": "async" } as const;

interface Part { id: string; label: string; x: number; w: number }
interface Msg { from: string; to: string; label: string; kind: "call" | "return" | "async" }

export function drawSequence(source: string, skin: Skin, ids: { slug: string; title: string; desc: string }): { svg: string; width: number; height: number } | string {
	const lines = source.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	if (!/^sequenceDiagram$/.test(lines[0] ?? "")) return "not a sequence diagram";
	const parts = new Map<string, Part>();
	const msgs: Msg[] = [];
	const add = (id: string, label?: string) => {
		if (!parts.has(id)) parts.set(id, { id, label: label ?? id, x: 0, w: 0 });
		else if (label) parts.get(id)!.label = label;
	};
	for (const line of lines.slice(1)) {
		const decl = /^(?:participant|actor)\s+([A-Za-z_]\w*)(?:\s+as\s+(.+))?$/.exec(line);
		if (decl) {
			add(decl[1], decl[2]?.trim());
			continue;
		}
		const m = /^([A-Za-z_]\w*)\s*(->>|-->>|--\)|-\))\s*([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(line);
		if (!m) return `a line this drawer does not read (${line.split(/\s+/)[0]})`;
		if (m[1] === m[3]) return "a message from a participant to itself";
		add(m[1]);
		add(m[3]);
		msgs.push({ from: m[1], to: m[3], label: m[4].trim(), kind: ARROWS[m[2] as keyof typeof ARROWS] });
	}
	if (!msgs.length) return "no messages";
	const list = [...parts.values()];
	if (list.length > 5) return "more than 5 lifelines";
	if (msgs.length > 12) return "more than 12 messages";
	if (msgs.some((x) => x.label.length > LABEL_MAX)) return `a message label over ${LABEL_MAX} characters`;
	for (const p of list) {
		if (p.label.length * 7.2 + 32 > 240) return "a participant name too wide";
		p.w = Math.min(240, Math.max(112, snap(p.label.length * 7.2 + 32)));
	}
	// Column centres: far enough apart for the boxes and for every label that spans the gap.
	const idx = new Map(list.map((p, i) => [p.id, i]));
	const gaps = list.slice(1).map((p, i) => (list[i].w + p.w) / 2 + 24);
	for (const x of msgs) {
		const [i, j] = [idx.get(x.from)!, idx.get(x.to)!].sort((a, b) => a - b);
		const need = Math.ceil(x.label.length * 5.4 + 8) + 40;
		for (let k = i; k < j; k++) gaps[k] = Math.max(gaps[k], Math.ceil(need / (j - i)));
	}
	let cx = 32 + list[0].w / 2;
	list.forEach((p, i) => {
		if (i) cx += snap(gaps[i - 1]);
		p.x = cx;
	});
	const span = list[list.length - 1].x + list[list.length - 1].w / 2 + 32;
	const width = Math.max(960, snap(span));
	const dx = Math.floor(Math.max(0, (width - span) / 2) / 4) * 4;
	const HEAD_Y = 32;
	const HEAD_H = 48;
	const first = HEAD_Y + HEAD_H + 40;
	const ys = msgs.map((_, i) => first + i * 44);
	const bottom = ys[ys.length - 1] + 40;
	const kinds = new Set(msgs.map((x) => x.kind));
	const legend = kinds.size > 1;
	const height = snap(bottom + (legend ? 60 : 0));
	const dash = (k: Msg["kind"]) => (k === "call" ? "" : ' stroke-dasharray="5,4"');
	const marker = (k: Msg["kind"]) => (k === "async" ? "arrow-open" : "arrow");
	const degree = (p: Part) => msgs.filter((x) => x.from === p.id || x.to === p.id).length;
	const hub = [...list].sort((a, b) => degree(b) - degree(a))[0];
	const focal = degree(hub) >= 3 && list.length > 2 ? hub.id : null;
	const out: string[] = [];
	out.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${ids.slug}-title ${ids.slug}-desc">`);
	out.push(`<title id="${ids.slug}-title">${esc(ids.title)}</title>`, `<desc id="${ids.slug}-desc">${esc(ids.desc)}</desc>`);
	out.push(`<defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${skin.muted}"/></marker><marker id="arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0, 8 3, 0 6" fill="none" stroke="${skin.muted}" stroke-width="1.2"/></marker></defs>`);
	out.push(`<rect width="100%" height="100%" fill="${skin.paper}"/>`);
	if (dx) out.push(`<g transform="translate(${dx} 0)">`);
	for (const p of list) out.push(`<line x1="${p.x}" y1="${HEAD_Y + HEAD_H}" x2="${p.x}" y2="${bottom}" stroke="${skin.muted}" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="4,4"/>`);
	const masks: string[] = [];
	msgs.forEach((x, i) => {
		const a = parts.get(x.from)!.x;
		const b = parts.get(x.to)!.x;
		const y = ys[i];
		const sign = b > a ? 1 : -1;
		out.push(`<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="${skin.muted}" stroke-width="1.2"${dash(x.kind)} marker-end="url(#${marker(x.kind)})"/>`);
		const w = Math.ceil(x.label.length * 5.4 + 8);
		const mx = (a + b) / 2;
		masks.push(`<rect x="${mx - w / 2}" y="${y - 22}" width="${w}" height="14" rx="2" fill="${skin.paper}"/><text x="${mx}" y="${y - 12}" fill="${skin.soft}" font-size="8" font-family="${MONO}" text-anchor="middle" letter-spacing="0.06em">${esc(x.label.toUpperCase())}</text>`);
		void sign;
	});
	out.push(...masks);
	for (const p of list) {
		const x = p.x - p.w / 2;
		const [fill, stroke] = p.id === focal ? [skin.accentTint, skin.accent] : [skin.node, skin.ink];
		out.push(`<rect x="${x}" y="${HEAD_Y}" width="${p.w}" height="${HEAD_H}" rx="6" fill="${skin.paper}"/><rect x="${x}" y="${HEAD_Y}" width="${p.w}" height="${HEAD_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1"/><text x="${p.x}" y="${HEAD_Y + HEAD_H / 2 + 4}" fill="${skin.ink}" font-size="12" font-weight="600" font-family="${SANS}" text-anchor="middle">${esc(p.label)}</text>`);
	}
	if (dx) out.push("</g>");
	if (legend) {
		out.push(`<line x1="30" y1="${bottom}" x2="${width - 30}" y2="${bottom}" stroke="${skin.rule}" stroke-width="0.8"/><text x="30" y="${bottom + 20}" fill="${skin.muted}" font-size="8" font-family="${MONO}" letter-spacing="0.14em">LEGEND</text>`);
		[...kinds].forEach((k, i) => {
			const d = k === "call" ? "" : ' stroke-dasharray="5,4"';
			out.push(`<line x1="${100 + i * 160}" y1="${bottom + 17}" x2="${128 + i * 160}" y2="${bottom + 17}" stroke="${skin.muted}" stroke-width="1.2"${d}/><text x="${138 + i * 160}" y="${bottom + 20}" fill="${skin.soft}" font-size="8" font-family="${MONO}" letter-spacing="0.08em">${k.toUpperCase()}</text>`);
		});
	}
	out.push("</svg>");
	return { svg: out.join("\n"), width, height };
}
