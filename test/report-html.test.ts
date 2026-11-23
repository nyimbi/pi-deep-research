import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestPassage, markdownToHtml, renderReportPage } from "../src/report-html.ts";

const SRC = new Map([["https://a.example/x", { title: "Source A", url: "https://a.example/x", tier: 1, content: "Intro line that is long enough to count as a paragraph here.\n\nThe connector timed out at 30 seconds in the observed tail latency measurements.\n\nUnrelated closing paragraph about something else entirely, long enough." }]]);

describe("markdownToHtml", () => {
	it("escapes raw html and keeps the subset", () => {
		const { html } = markdownToHtml("# T\n\n## H\n\n<script>alert(1)</script> **bold** and `a<b`\n\n- one\n- two\n\n1. x\n2. y\n");
		assert.ok(!html.includes("<script>"));
		assert.match(html, /&lt;script&gt;/);
		assert.match(html, /<strong>bold<\/strong>/);
		assert.match(html, /<code>a&lt;b<\/code>/);
		assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
		assert.match(html, /<ol><li>x<\/li><li>y<\/li><\/ol>/);
	});
	it("shows a tier emoji as a badge, not an emoji", () => {
		const { html } = markdownToHtml("| a | t |\n|---|---|\n| x | ⭐ Tier 1 |\n| y | 🔴 Tier 4 |\n");
		assert.match(html, /<span class="tier t1">Tier 1<\/span>/);
		assert.match(html, /<span class="tier">Tier 4<\/span>/);
		assert.ok(!/[⭐🔴]/u.test(html));
	});
	it("shows a derived tag as a small calc marker that names the value", () => {
		const { html } = markdownToHtml("Room is 8.5% (derived: headroom_pct).\n");
		assert.match(html, /8\.5%<sup class="derived" title="Computed in the calculation: headroom_pct">calc<\/sup>\./);
		assert.ok(!html.includes("(derived"));
	});
	it("draws a thematic break instead of printing the dashes", () => {
		const { html } = markdownToHtml("# T\n\nA.\n\n---\n\nB.\n");
		assert.match(html, /<p>A\.<\/p>\n<hr>\n<p>B\.<\/p>/);
	});
	it("drops the first h1 (the page title carries it) and ids the headings", () => {
		const { html, headings } = markdownToHtml("# Title\n\n## A b\n\n## A b\n");
		assert.ok(!html.includes("<h1"));
		assert.deepEqual(headings.map((h) => h.id), ["a-b", "a-b-2"]);
	});
	it("renders a table with alignment and an unsafe link as inert", () => {
		const { html } = markdownToHtml("| A | B |\n|:-:|--:|\n| [x](javascript:alert(1)) | 2 |\n");
		assert.match(html, /<th style="text-align:center">A<\/th>/);
		assert.match(html, /<td style="text-align:right">2<\/td>/);
		assert.match(html, /href="#"/);
		assert.ok(!html.includes("javascript:"));
	});
	it("numbers a cited source once and records the sentence that cited it", () => {
		const { html, cited } = markdownToHtml("# T\n\nThe tail is 30 s ([A](https://a.example/x)). Again ([A](https://a.example/x)).\n", { sources: SRC });
		assert.equal(cited.length, 1);
		assert.match(cited[0]!.sentence, /The tail is 30 s/);
		assert.equal((html.match(/data-ref="1"/g) ?? []).length, 2);
	});
	it("swaps a mermaid block for the data-uri diagram and keeps the source when none was drawn", () => {
		const md = "# T\n\nA flow of one step.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter.\n";
		const drawn = markdownToHtml(md, { diagrams: [{ index: 1, svg: "<svg/>", dark: "<svg id='d'/>" }] }).html;
		assert.match(drawn, /<picture><source media="\(prefers-color-scheme: dark\)" srcset="data:image\/svg\+xml;base64,/);
		assert.ok(!drawn.includes("flowchart"));
		assert.match(markdownToHtml(md).html, /mermaid-source/);
	});
});

describe("renderReportPage", () => {
	const page = renderReportPage("# Timeout\n\n## Findings\n\nThe tail is 30 seconds observed ([A](https://a.example/x)).\n", { sources: SRC, colophon: [{ label: "Depth", value: "deep" }], limits: ["Not checked."] });
	it("is self-contained: no external fetches", () => {
		assert.ok(!/<link\b|<script[^>]+src=|@import|url\(https?:/.test(page.html));
	});
	it("has the contents, the passage drawer and the colophon", () => {
		assert.match(page.html, /<nav class="toc"[\s\S]*href="#findings"/);
		assert.match(page.html, /<details class="passage" id="ref-1"[\s\S]*timed out at 30 seconds/);
		assert.match(page.html, /id="colophon"[\s\S]*Not checked\./);
		assert.match(page.html, /prefers-color-scheme:dark/);
		assert.match(page.html, /@media print/);
	});
});

describe("bestPassage", () => {
	it("picks the paragraph sharing the most words and returns empty without overlap", () => {
		const c = SRC.get("https://a.example/x")!.content;
		assert.match(bestPassage("the observed tail latency was 30 seconds", c), /timed out at 30 seconds/);
		assert.equal(bestPassage("zebra quartz", c), "");
	});
});
