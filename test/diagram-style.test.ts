import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runDesignGates } from "../src/diagram-render.ts";
import { editorialPage, editorialSvg, styleForPackage, styleRefusal } from "../src/diagram-style.ts";

const opts = (slug = "d1") => ({ slug, title: "Pipeline", desc: "The request path through the pipeline." });
const LR = "flowchart LR\n  Q[Question] -->|plans| P[Planner]\n  P -->|searches| S[Search]\n  P -->|extracts| X[Extract]\n  S -->|ranks| L[(Ledger)]\n  X -->|archives| L\n  L -->|cites| R[Report]";
const SKILL = join(homedir(), ".claude", "skills", "diagram-design");

const pathsOf = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
/** Every straight leg of a connector must share an x or a y with the previous point: no diagonals. */
function diagonals(d: string): number {
	const pts = [...d.matchAll(/([MLQ])([\d.\s-]+)/g)].flatMap((m) => {
		const n = m[2].trim().split(/\s+/).map(Number);
		return m[1] === "Q" ? [[n[2], n[3]]] : [[n[0], n[1]]];
	});
	const legs = [...d.matchAll(/([MLQ])([\d.\s-]+)/g)];
	let bad = 0;
	let prev = pts[0];
	legs.forEach((leg, i) => {
		if (leg[1] === "L" && prev[0] !== pts[i][0] && prev[1] !== pts[i][1]) bad++;
		prev = pts[i];
	});
	return bad;
}

describe("editorialSvg", () => {
	const r = editorialSvg(LR, opts())!;
	it("draws an accessible figure in the skin's tokens, with one accent and no shadows", () => {
		assert.ok(r);
		assert.match(r.svg, /role="img" aria-labelledby="d1-title d1-desc"/);
		assert.match(r.svg, /<title id="d1-title">Pipeline<\/title>\s*<desc id="d1-desc">The request path/);
		assert.ok(r.svg.indexOf("<title") < r.svg.indexOf("<defs"));
		assert.match(r.svg, /fill="#f5f5f5"/);
		assert.equal(r.svg.match(/stroke="#bf4520" stroke-width="1"/g)?.length, 1, "exactly one focal node");
		assert.ok(!/filter|box-shadow|drop-shadow/.test(r.svg));
		assert.ok(!/<line[^>]*\bx1="(\d+)"[^>]*\by1="(\d+)"[^>]*\bx2="(?!\1)\d+"[^>]*\by2="(?!\2)\d+"/.test(r.svg));
	});
	it("draws every connector with right angles only", () => {
		const paths = pathsOf(r.svg);
		assert.equal(paths.length, 6);
		assert.equal(paths.reduce((n, d) => n + diagonals(d), 0), 0);
		assert.ok(paths.some((d) => d.includes("Q")), "at least one elbow is rounded");
	});
	it("gives connectors on one edge their own port, 12px or more apart", () => {
		const starts = pathsOf(r.svg).map((d) => /^M([\d.]+) ([\d.]+)/.exec(d)!).filter((m) => m[1] === pathsOf(r.svg).map((p) => /^M([\d.]+)/.exec(p)![1])[1]);
		const fromPlanner = pathsOf(r.svg).filter((d) => d.startsWith(`M${starts[0][1]} `));
		const ys = fromPlanner.map((d) => Number(/^M[\d.]+ ([\d.]+)/.exec(d)![1])).sort((a, b) => a - b);
		assert.ok(ys.length >= 2);
		for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 12, `ports ${ys}`);
	});
	it("masks each arrow label, 6 to 10px above the connector it names", () => {
		const masks = [...r.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="14" rx="2"/g)].map((m) => Number(m[1]));
		assert.equal(masks.length, 6);
		const ends = pathsOf(r.svg).map((d) => Number(/L[\d.]+ ([\d.]+)$/.exec(d)![1]));
		for (const y of masks) assert.ok(ends.some((e) => e - (y + 14) >= 6 && e - (y + 14) <= 10), `mask at ${y} has no connector 6 to 10px below it (${ends})`);
		assert.match(r.svg, />SEARCHES</);
	});
	it("refuses what it cannot draw, and says why", () => {
		const cases: Array<[string, RegExp]> = [
			["flowchart LR\n subgraph A[x]\n subgraph B[y]\n a --> b\n end\n end", /not a flowchart/],
			["flowchart LR\n subgraph A[x]\n a --> b\n end\n subgraph B[y]\n c --> d\n end\n b --> c", /crosses between subgraphs/],
			["flowchart LR\n a -->|x| b\n b -->|y| c\n c -->|z| d\n linkStyle 0,1,2 stroke:#d33", /more than 2 accent/],
			["flowchart LR\n A --> B\n B --> A", /cycle/],
			["flowchart LR\n A -->|this label is too long| B", /14 characters/],
			["sequenceDiagram\n A->>B: hi", /not a flowchart/],
			["flowchart LR\n" + Array.from({ length: 10 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n"), /over 9 nodes/],
		];
		for (const [src, why] of cases) {
			assert.equal(editorialSvg(src, opts()), null);
			assert.match(styleRefusal() ?? "", why);
		}
	});
	it("draws each subgraph as a titled frame and marks linkStyle arrows with the accent", () => {
		const src = 'flowchart LR\n  subgraph A["Option A: direct"]\n    a1[Client] -->|writes| a2[(Store)]\n  end\n  subgraph B["Option B: queued"]\n    b1[Client] -->|enqueues| b2[Queue]\n    b2 -->|drains| b3[(Store)]\n  end\n  linkStyle 1,2 stroke:#d33,stroke-width:3px';
		const out = editorialSvg(src, opts())!;
		assert.ok(out, styleRefusal() ?? "");
		assert.match(out.svg, />OPTION A: DIRECT</);
		assert.match(out.svg, />OPTION B: QUEUED</);
		assert.equal((out.svg.match(/stroke="#bf4520"[^>]*marker-end="url\(#arrow-accent\)"/g) ?? []).length, 2);
		assert.equal((out.svg.match(/<path d=/g) ?? []).length, 3);
		assert.equal((out.svg.match(/stroke-opacity="0.35"/g) ?? []).length, 2);
		for (const d of pathsOf(out.svg)) assert.equal(diagonals(d), 0);
		const td = editorialSvg(src.replace("LR", "TD"), opts())!;
		assert.ok(td && td.width >= 960);
	});
	it("escapes labels", () => {
		const out = editorialSvg('flowchart LR\n  A["a < b"] -->|go| B[x]', opts())!;
		assert.match(out.svg, /a &lt; b/);
		assert.ok(!out.svg.includes("a < b"));
	});
	it("lays a top-down chart out vertically", () => {
		const td = editorialSvg("flowchart TD\n  A[Client] -->|writes| B[Queue]", opts())!;
		const [a, b] = [...td.svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="\d+" height="48" rx="6" fill="#ffffff"/g)];
		assert.equal(a[1], b[1]);
		assert.ok(Number(b[2]) > Number(a[2]));
	});
});

describe("editorialPage and the package hook", () => {
	it("wraps the figure in the skill's page shape: fonts, scroller, min-width equal to the viewBox", () => {
		const r = editorialSvg(LR, opts())!;
		const html = editorialPage(r, { title: "Pipeline", eyebrow: "Flowchart" });
		assert.match(html, /fonts\.googleapis\.com/);
		assert.match(html, /\.diagram-container \{[^}]*overflow-x: auto/);
		assert.match(html, new RegExp(`min-width: ${r.width}px`));
	});
	it("takes the title and desc from the caption, and from the node labels without one", () => {
		const a = styleForPackage("flowchart LR\n  A[One] -->|go| B[Two]", { index: 3, caption: "A short caption sentence for the figure." }) as { svg: string };
		assert.match(a.svg, /<desc id="diagram-3-desc">A short caption sentence for the figure\.<\/desc>/);
		const b = styleForPackage("flowchart LR\n  A[One] -->|go| B[Two]", { index: 4, caption: undefined }) as { svg: string };
		assert.match(b.svg, /Flowchart of One, Two\./);
		assert.deepEqual(Object.keys(styleForPackage("pie\n \"a\": 1", { index: 1, caption: undefined })), ["refused"]);
	});
});

describe("the diagram-design skill's own checks", { skip: !existsSync(join(SKILL, "scripts", "self_check.py")) }, () => {
	const write = async (html: string) => {
		const dir = await mkdtemp(join(tmpdir(), "pi-dd-"));
		const file = join(dir, "d.html");
		await writeFile(file, html, "utf8");
		return file;
	};
	it("pass a drawn page, and fail a page with a diagonal connector and one with no accessible name", async () => {
		const r = editorialSvg(LR, opts())!;
		const good = editorialPage(r, { title: "Pipeline", eyebrow: "Flowchart" });
		assert.deepEqual(await runDesignGates(await write(good), SKILL), []);
		const slanted = good.replace(/(<path d="M)(\d+) (\d+) L(\d+) \3/, "$1$2 $3 L$4 " + "999");
		assert.notEqual(slanted, good, "the canary patch applied");
		assert.ok((await runDesignGates(await write(slanted), SKILL)).length >= 1, "a slanted connector is caught");
		const unnamed = good.replace(/ role="img" aria-labelledby="[^"]*"/, "");
		assert.notEqual(unnamed, good);
		assert.match((await runDesignGates(await write(unnamed), SKILL)).join("\n"), /self_check/);
	});
	it("a missing skill directory runs nothing", async () => {
		assert.deepEqual(await runDesignGates("/nonexistent.html", "/nonexistent-skill"), []);
	});
});
