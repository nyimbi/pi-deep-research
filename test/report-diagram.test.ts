import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { mermaidBlocks } from "../src/diagrams.ts";
import { DARK, editorialSvg } from "../src/diagram-style.ts";
import { interactiveFigure, partsOf, scopeIds, sentenceAbout } from "../src/report-diagram.ts";
import { renderReportPage } from "../src/report-html.ts";
import { findChrome } from "../src/report-render.ts";

const SRC = "flowchart LR\n  A[Request] --> B[Retry queue]\n  B --> C{Backoff gate}\n  C -->|allowed| D[Upstream]\n  C -->|exhausted| E[Dead letter store]";
const REPORT = `# T\n\n## How it works\n\nA request enters the retry queue. Each attempt then passes the backoff gate, which doubles the wait.\n\nThe Upstream answers or times out.\n\n\`\`\`mermaid\n${SRC}\n\`\`\`\n\nFigure 1. The retry path.\n`;
const draw = (skin?: typeof DARK) => (editorialSvg(SRC, { slug: "d1", title: "t", desc: "d", ...(skin ? { skin } : {}) } as never) as { svg: string }).svg;

describe("sentenceAbout", () => {
	it("returns the first prose sentence naming the part, as plain text", () => {
		assert.equal(sentenceAbout("Backoff gate", "# Backoff gate\n\nA [request](x) enters. Each attempt then passes the **backoff gate**, which doubles the wait. Later."), "Each attempt then passes the backoff gate, which doubles the wait.");
		assert.equal(sentenceAbout("Nowhere", "Some text."), "");
		assert.equal(sentenceAbout("  ", "Some text."), "");
	});
	it("skips headings, tables and fences", () => {
		assert.equal(sentenceAbout("Queue", "## Queue\n\n| Queue | x |\n|---|---|\n\n```\nQueue here\n```"), "");
	});
});

describe("scopeIds", () => {
	it("prefixes ids, url references and aria-labelledby together", () => {
		const out = scopeIds('<svg aria-labelledby="a-title a-desc"><title id="a-title"/><marker id="arrow"/><path marker-end="url(#arrow)"/></svg>', "f1l-");
		assert.match(out, /id="f1l-arrow"/);
		assert.match(out, /url\(#f1l-arrow\)/);
		assert.match(out, /aria-labelledby="f1l-a-title f1l-a-desc"/);
		assert.match(out, /id="f1l-a-title"/);
	});
});

describe("interactiveFigure", () => {
	it("inlines both skins with no shared id, and a plate naming every part", () => {
		const html = interactiveFigure({ n: 1, caption: "The retry path.", svg: draw(), dark: draw(DARK), prose: REPORT })!;
		assert.ok(!html.includes("<img"));
		const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
		assert.equal(new Set(ids).size, ids.length, "ids unique across both skins");
		assert.equal((html.match(/<svg /g) ?? []).length, 2);
		for (const label of ["Request", "Retry queue", "Backoff gate", "Upstream", "Dead letter store"]) assert.ok(html.includes(`>${label}</button>`), label);
		assert.match(html, /data-note="Each attempt then passes the backoff gate, which doubles the wait\."/);
	});
	it("escapes a hostile label in the plate and the note", () => {
		const svg = (editorialSvg('flowchart LR\n  A["<b>x</b>"] --> B[Next]', { slug: "d1", title: "t", desc: "d" }) as { svg: string } | null)?.svg;
		const html = interactiveFigure({ n: 1, caption: "c", svg: svg!, prose: "" })!;
		assert.ok(!html.includes("<b>x"));
	});
	it("returns null for a drawing with no parts to point at", () => {
		assert.equal(interactiveFigure({ n: 1, caption: "c", svg: "<svg viewBox='0 0 1 1'></svg>", prose: "" }), null);
		const seq = (editorialSvg("sequenceDiagram\n participant C as Client\n participant A as API\n C->>A: GET", { slug: "d1", title: "t", desc: "d" }) as { svg: string }).svg;
		assert.equal(interactiveFigure({ n: 1, caption: "c", svg: seq, prose: "" }), null);
	});
	it("keeps a skin out when its parts differ from the light drawing's", () => {
		const other = (editorialSvg("flowchart LR\n  A[One] --> B[Two]", { slug: "d1", title: "t", desc: "d" }) as { svg: string }).svg;
		assert.equal((interactiveFigure({ n: 1, caption: "c", svg: draw(), dark: other, prose: "" })!.match(/<svg /g) ?? []).length, 1);
	});
	it("marks the legend and a back arrow so the page can crop and order", () => {
		assert.match(draw(), /<g class="legend">/);
		const loop = (editorialSvg("flowchart LR\n  A[Send] --> B{Acked?}\n  B -->|yes| C[Done]\n  B -->|no| A", { slug: "d1", title: "t", desc: "d" }) as { svg: string }).svg;
		assert.equal((loop.match(/data-back="1"/g) ?? []).length, 1);
		assert.ok(!draw().includes("data-back"));
	});
	it("tags every part, connector and label for the page script", () => {
		const svg = draw();
		assert.equal(partsOf(svg).length, 5);
		assert.equal((svg.match(/<path d="[^"]+" data-from="\w+" data-to="\w+"/g) ?? []).length, 4);
		assert.equal((svg.match(/<g class="lbl" data-from=/g) ?? []).length, 2);
	});
	it("is used by the report page, which keeps an img for a diagram it cannot make interactive", () => {
		const block = mermaidBlocks(REPORT)[0]!;
		const page = renderReportPage(REPORT, { diagrams: [{ index: block.index, svg: draw(), dark: draw(DARK) }] }).html;
		assert.match(page, /<figure class="diagram ix"/);
		assert.match(page, /Takes from /);
		const plain = renderReportPage(REPORT, { diagrams: [{ index: block.index, svg: "<svg viewBox='0 0 9 9'></svg>" }] }).html;
		assert.match(plain, /<figure class="diagram"><picture>/);
	});
});

const chrome = findChrome();
describe("the interactive figure in headless Chrome", { skip: chrome ? false : "no Chrome on this machine" }, () => {
	const run = async (script: string): Promise<Record<string, unknown>> => {
		const block = mermaidBlocks(REPORT)[0]!;
		const html = renderReportPage(REPORT, { diagrams: [{ index: block.index, svg: draw(), dark: draw(DARK) }] }).html.replace("</body>", `<script>window.addEventListener("load",function(){var f=document.querySelector("figure.ix"),out={};try{${script}}catch(e){out.error=String(e)}document.title=JSON.stringify(out)})</script></body>`);
		const dir = await mkdtemp(join(tmpdir(), "ix-"));
		try {
			const file = join(dir, "r.html");
			await writeFile(file, html);
			const { stdout } = await promisify(execFile)(chrome!, ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${join(dir, "p")}`, "--virtual-time-budget=2000", "--dump-dom", `file://${file}`], { maxBuffer: 32e6, timeout: 60000 });
			return JSON.parse(/<title>([^<]*)<\/title>/.exec(stdout)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	};
	it("steps through the flow in order, with the accent on the current part only", async () => {
		const r = await run(`var s=f.querySelector("svg.dg"),next=f.querySelector("[data-do=next]");out.steps=[];for(var i=0;i<5;i++){next.click();out.steps.push([f.querySelector(".stepno").textContent,[].map.call(s.querySelectorAll("g.node.cur"),function(g){return g.dataset.label}).join("|"),s.querySelectorAll("g.node.on").length])}`);
		assert.deepEqual(r.steps, [["Step 1 of 5", "Request", 1], ["Step 2 of 5", "Retry queue", 2], ["Step 3 of 5", "Backoff gate", 3], ["Step 4 of 5", "Upstream", 4], ["Step 5 of 5", "Dead letter store", 5]]);
	});
	it("selects a part from the plate, and clears on a second press", async () => {
		const r = await run(`var s=f.querySelector("svg.dg"),b=f.querySelector(".plate button[data-node=C]");b.click();out.on=[].map.call(s.querySelectorAll("g.node.on"),function(g){return g.dataset.node}).sort().join("");out.note=f.querySelector(".note").textContent;out.pressed=b.getAttribute("aria-pressed");b.click();out.after=s.classList.contains("focus");out.cleared=f.querySelector(".note").textContent`);
		assert.equal(r.on, "BCDE");
		assert.match(String(r.note), /Backoff gate Each attempt then passes the backoff gate.*Takes from Retry queue\. Hands to Upstream \(allowed\), Dead letter store \(exhausted\)\./);
		assert.equal(r.pressed, "true");
		assert.equal(r.after, false);
		assert.equal(r.cleared, "");
	});
	it("zooms in and out within bounds, and resets", async () => {
		const r = await run(`var s=f.querySelector("svg.dg"),w=function(){return Number(s.getAttribute("viewBox").split(" ")[2])};var w0=w();for(var i=0;i<20;i++)f.querySelector("[data-do=in]").click();out.zoomed=w0/w();out.cls=f.querySelector(".stage").classList.contains("zoomed");for(var j=0;j<40;j++)f.querySelector("[data-do=out]").click();out.back=w()===w0;f.querySelector("[data-do=in]").click();f.querySelector("[data-do=reset]").click();out.reset=w()===w0`);
		assert.equal(r.zoomed, 5);
		assert.equal(r.cls, true);
		assert.equal(r.back, true);
		assert.equal(r.reset, true);
	});
	it("answers the keyboard: arrows step, Escape clears", async () => {
		const r = await run(`var ev=function(k){f.dispatchEvent(new KeyboardEvent("keydown",{key:k,bubbles:true}))};ev("ArrowRight");ev("ArrowRight");out.a=f.querySelector(".stepno").textContent;ev("Escape");out.b=f.querySelector(".stepno").textContent;out.focusable=f.querySelectorAll("svg.dg g.node[tabindex='0']").length`);
		assert.equal(r.a, "Step 2 of 5");
		assert.equal(r.b, "All parts");
		assert.equal(r.focusable, 10);
	});
	it("crops to the drawing and drops the legend, so the parts are legible", async () => {
		const r = await run(`var s=f.querySelector("svg.dg");out.w=Number(s.getAttribute("viewBox").split(" ")[2]);out.h=Number(s.getAttribute("viewBox").split(" ")[3]);out.fit=s.classList.contains("fit")`);
		assert.equal(r.fit, true);
		const full = Number(/viewBox="0 0 (\d+)/.exec(draw())![1]);
		assert.ok(Number(r.w) < full, `cropped ${r.w} against the canvas ${full}`);
		const fullH = Number(/viewBox="0 0 \d+ (\d+)/.exec(draw())![1]);
		assert.ok(Number(r.h) < fullH - 40, `cropped height ${r.h} against ${fullH}: the legend strip is out`);
	});
});
