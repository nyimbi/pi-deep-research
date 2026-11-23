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
			["flowchart LR\n subgraph A[x]\n subgraph B[y]\n a --> b\n end\n end", /not a diagram/],
			["flowchart LR\n a -->|x| b\n b -->|y| c\n c -->|z| d\n linkStyle 0,1,2 stroke:#d33", /more than 2 accent/],
			["flowchart LR\n A --> B\n B --> B", /to itself/],
			["stateDiagram-v2\n state X {\n a --> b\n }", /not a diagram/],
			["sequenceDiagram\n A->>B: hi\n par ok\n B-->>A: yes\n end", /does not read/],
			["sequenceDiagram\n A->>B: hi\n alt a\n loop b\n B-->>A: yes\n end\n end", /inside a fragment/],
			["sequenceDiagram\n A->>B: hi\n alt a\n else b\n B-->>A: yes\n end", /empty/],
			["sequenceDiagram\n A->>B: hi\n opt a\n B-->>A: yes", /never closed/],
			["sequenceDiagram\n opt a\n A->>B: 1\n end\n opt b\n A->>B: 2\n end\n opt c\n A->>B: 3\n end", /fragments than the skill allows/],
			["sequenceDiagram\n alt a\n A->>B: 1\n end\n opt b\n A->>B: 2\n end", /fragments than the skill allows/],
			["sequenceDiagram\n alt a\n A->>B: 1\n else b\n A->>B: 2\n else c\n A->>B: 3\n end", /more than two regions/],
			["sequenceDiagram\n A->>A: think", /itself/],
			["sequenceDiagram\n A->>B: x\n B->>C: x\n C->>D: x\n D->>E: x\n E->>F: x", /5 lifelines/],
			["flowchart LR\n A -->|this label is too long| B", /14 characters/],
			["erDiagram\n A ||--o{ B : has", /not a diagram/],
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
	it("draws arrows between subgraphs, with frames that do not meet", () => {
		const src = 'flowchart LR\n  subgraph A["Option A"]\n    a1[Client] -->|writes| a2[(Store)]\n  end\n  subgraph B["Option B"]\n    b1[Queue] -->|drains| b2[(Primary)]\n  end\n  a1 -->|enqueues| b1';
		const out = editorialSvg(src, opts())!;
		assert.ok(out, styleRefusal() ?? "");
		const frames = [...out.svg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" rx="6" fill="none"/g)].map((m) => m.slice(1).map(Number));
		assert.equal(frames.length, 2);
		const [f, g] = frames;
		assert.ok(f[0] + f[2] <= g[0] || g[0] + g[2] <= f[0] || f[1] + f[3] <= g[1] || g[1] + g[3] <= f[1], "frames overlap");
		assert.equal((out.svg.match(/<path d=/g) ?? []).length, 3);
		for (const d of pathsOf(out.svg)) assert.equal(diagonals(d), 0);
	});
	it("routes a back arrow along a lane and draws start and end markers", () => {
		const out = editorialSvg("stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> [*]", opts())!;
		assert.ok(out, styleRefusal() ?? "");
		assert.equal((out.svg.match(/<circle/g) ?? []).length, 3);
		assert.ok(!/Q/.test(pathsOf(out.svg)[0]) && !/Q/.test(pathsOf(out.svg)[2]), "start and end markers connect in a straight line");
		assert.equal((out.svg.match(/<path d=/g) ?? []).length, 4);
		const back = pathsOf(out.svg).find((d) => d.includes("Q") && /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ Q/.test(d) && d.split("Q").length === 3 && /L[\d.]+ ([\d.]+)$/.test(d));
		assert.ok(back);
		for (const d of pathsOf(out.svg)) assert.equal(diagonals(d), 0);
		assert.match(out.svg, />STOP</);
	});
	it("refuses two back arrows that would have to cross", () => {
		assert.equal(editorialSvg("flowchart LR\n A --> B\n B --> C\n C --> D\n D --> B\n C --> A", opts()), null);
		assert.match(styleRefusal() ?? "", /cross/);
	});
	it("keeps frames apart when a long title is wider than its members", () => {
		const long = (c: string) => `subgraph ${c}["${c} is a deliberately long subgraph title"]\n ${c.toLowerCase()}1[X] -->|go| ${c.toLowerCase()}2[Y]\n end`;
		const out = editorialSvg(`flowchart TD\n ${long("A")}\n ${long("B")}\n a1 -->|link| b1`, opts());
		if (!out) return assert.match(styleRefusal() ?? "", /frames would overlap/);
		const f = [...out.svg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" rx="6" fill="none"/g)].map((m) => m.slice(1).map(Number));
		assert.equal(f.length, 2);
		assert.ok(f[0][0] + f[0][2] <= f[1][0] || f[1][0] + f[1][2] <= f[0][0] || f[0][1] + f[0][3] <= f[1][1] || f[1][1] + f[1][3] <= f[0][1]);
	});
	it("draws a flowchart cycle instead of refusing it", () => {
		const out = editorialSvg("flowchart LR\n A[Plan] -->|go| B[Act]\n B -->|check| C[Review]\n C -->|retry| A", opts())!;
		assert.ok(out, styleRefusal() ?? "");
		assert.equal((out.svg.match(/<path d=/g) ?? []).length, 3);
	});
	it("draws a sequence diagram: lifelines, call, return and async kinds, labels clear of the line", () => {
		const out = editorialSvg("sequenceDiagram\n participant C as Client\n participant A as API\n C->>A: GET /report\n A-->>C: 200 OK\n C-)A: ack", opts())!;
		assert.ok(out, styleRefusal() ?? "");
		assert.match(out.svg, /role="img"/);
		assert.equal((out.svg.match(/stroke-dasharray="4,4"/g) ?? []).length, 2);
		assert.equal((out.svg.match(/marker-end="url\(#arrow-open\)"/g) ?? []).length, 1);
		assert.equal((out.svg.match(/<line[^>]*stroke-dasharray="5,4"[^>]*marker-end="url\(#arrow\)"/g) ?? []).length, 1);
		// each mask sits 6 to 10px above its message line
		const lines = [...out.svg.matchAll(/<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="\1" stroke="#4f5d75" stroke-width="1.2"/g)].map((m) => Number(m[1]));
		const masks = [...out.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="14" rx="2" fill="#f5f5f5"/g)].map((m) => Number(m[1]));
		assert.equal(masks.length, 3);
		for (const [i, y] of masks.entries()) assert.ok(lines[i] - (y + 14) >= 6 && lines[i] - (y + 14) <= 10);
		assert.match(out.svg, />200 OK</);
	});
	it("draws alt, opt and loop as frames spanning only the lifelines that speak inside them", () => {
		const head = "sequenceDiagram\n participant C as Client\n participant A as API\n participant I as Identity\n";
		const frameRects = (svg: string) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="4" fill="#2d3142" fill-opacity="0.02"/g)].map((m) => m.slice(1).map(Number));
		const lifelines = (svg: string) => [...svg.matchAll(/<line x1="([\d.]+)" y1="\d+" x2="\1" y2="\d+" stroke="#4f5d75" stroke-opacity="0.5"/g)].map((m) => Number(m[1]));
		const alt = editorialSvg(head + " C->>A: GET /report\n alt token valid\n A-->>C: 200 OK\n else token expired\n A->>I: refresh\n I-->>A: new token\n end\n C-)A: ack", opts())!;
		assert.ok(alt, styleRefusal() ?? "");
		assert.deepEqual([...alt.svg.matchAll(/letter-spacing="0.12em">(ALT|OPT|LOOP)</g)].map((m) => m[1]), ["ALT"]);
		assert.match(alt.svg, /\[token valid\]/);
		assert.match(alt.svg, /\[token expired\]/);
		assert.equal((alt.svg.match(/stroke-dasharray="4,3"/g) ?? []).length, 1, "one alt divider");
		assert.equal(frameRects(alt.svg).length, 1);
		const [fa] = frameRects(alt.svg);
		const maskYs = [...alt.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="14" rx="2" fill="#f5f5f5"/g)].map((m) => Number(m[1]));
		assert.ok(maskYs[maskYs.length - 1] >= fa[1] + fa[3] + 4, "the message after the frame starts clear below it");
		const two = editorialSvg(head + " loop each page\n C->>A: next\n A-->>C: page\n end\n opt more\n C-)I: notify\n end", opts())!;
		assert.ok(two, styleRefusal() ?? "");
		assert.deepEqual([...two.svg.matchAll(/letter-spacing="0.12em">(ALT|OPT|LOOP)</g)].map((m) => m[1]), ["LOOP", "OPT"]);
		const [loop, opt] = frameRects(two.svg);
		const [, , idLife] = lifelines(two.svg);
		assert.ok(loop[0] + loop[2] < idLife, "the loop uses Client and API only, so it stops short of Identity");
		assert.ok(opt[0] + opt[2] > idLife, "the opt reaches Identity");
		assert.ok(loop[1] + loop[3] + 12 <= opt[1], "frames are clear of one another");
	});
	it("returns the same drawing in the dark skin, with the dark tokens and no light ones", () => {
		const r = styleForPackage(LR, { index: 1, caption: "The path." });
		assert.ok("dark" in r);
		const { svg, html } = r.dark;
		assert.match(svg, /<rect width="100%" height="100%" fill="#2d3142"\/>/);
		assert.match(svg, /#f08a59/);
		for (const light of ["#bf4520", "#4f5d75", "#5a6580", "#ffffff"]) assert.ok(!svg.includes(light), `${light} is a light-skin token`);
		assert.match(html, /background: #2d3142; color: #f5f5f5/);
		assert.equal(svg.replace(/#[0-9a-fA-F]{6}|rgba\([^)]*\)/g, "C"), r.svg.replace(/#[0-9a-fA-F]{6}|rgba\([^)]*\)/g, "C"), "only colours differ");
		const seq = styleForPackage("sequenceDiagram\n A->>B: hi\n opt x\n B-->>A: yo\n end", { index: 2, caption: undefined });
		assert.ok("dark" in seq && !seq.dark.svg.includes("#4f5d75") && seq.dark.svg.includes("#bfc0c0"));
	});
	it("reads an arrow written without spaces", () => {
		assert.ok(editorialSvg("sequenceDiagram\n A->>B: hi\n B-->>A: yo", opts()));
		assert.ok(editorialSvg("flowchart LR\n A-->B", opts()));
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
		assert.match(b.svg, /Flowchart diagram of One, Two\./);
		assert.deepEqual(Object.keys(styleForPackage("pie\n \"a\": 1", { index: 1, caption: undefined })), ["refused"]);
	});
});

describe("the diagram-design skill's own checks on every drawn type", { skip: !existsSync(join(SKILL, "scripts", "self_check.py")) }, () => {
	const samples: Record<string, string> = {
		"subgraphs with an arrow between": 'flowchart LR\n  subgraph A["Option A"]\n    a1[Client] -->|writes| a2[(Store)]\n  end\n  subgraph B["Option B"]\n    b1[Queue] -->|drains| b2[(Primary)]\n  end\n  a1 -->|enqueues| b1',
		"a state diagram with a loop": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> Failed: error\n  Failed --> [*]",
		"a left-to-right state diagram": "stateDiagram-v2\n  direction LR\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> [*]",
		"a flowchart cycle": "flowchart LR\n A[Plan] -->|go| B[Act]\n B -->|check| C[Review]\n C -->|retry| A",
		"a sequence diagram with an alt": "sequenceDiagram\n participant C as Client\n participant A as API\n participant I as Identity\n C->>A: GET /report\n alt token valid\n A-->>C: 200 OK\n else token expired\n A->>I: refresh\n I-->>A: new token\n end\n C-)A: ack",
		"a sequence diagram with a loop then an opt": "sequenceDiagram\n participant C as Client\n participant A as API\n participant I as Identity\n loop each page\n C->>A: next\n A-->>C: page\n end\n opt more\n C-)I: notify\n end",
		"a sequence diagram": "sequenceDiagram\n participant C as Client\n participant A as API\n participant D as Database\n C->>A: GET /report\n A->>D: query\n D-->>A: rows\n A-->>C: 200 OK\n C-)A: ack",
	};
	for (const [name, src] of Object.entries(samples)) {
		it(`passes self_check and verify-geometry: ${name}`, async () => {
			const r = styleForPackage(src, { index: 1, caption: "A sample diagram." });
			assert.ok("html" in r, "refused" in r ? r.refused : "");
			const dir = await mkdtemp(join(tmpdir(), "dd-types-"));
			const file = join(dir, "d.html");
			await writeFile(file, r.html);
			assert.deepEqual(await runDesignGates(file, SKILL), []);
			assert.ok("dark" in r);
			const darkFile = join(dir, "d.dark.html");
			await writeFile(darkFile, r.dark.html);
			assert.deepEqual(await runDesignGates(darkFile, SKILL), []);
		});
	}
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
