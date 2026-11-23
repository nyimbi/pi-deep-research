import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { baselineStrip, evaluateHtml, local, type HtmlFixturePage } from "../src/html-eval.ts";
import { extractHtml } from "../src/html-extract.ts";
import { createLocalExtractProvider } from "../src/native/local-extract.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const pages = JSON.parse(readFileSync(new URL("./fixtures/html/pages.json", import.meta.url), "utf8")) as HtmlFixturePage[];
const hasPdftotext = (() => { try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe("local html extractor", () => {
	it("beats the regex baseline on every page type", () => {
		const a = evaluateHtml(pages, local);
		const b = evaluateHtml(pages, baselineStrip);
		for (const type of Object.keys(a)) assert.ok(a[type] > b[type], `${type}: local ${a[type]} vs baseline ${b[type]}`);
		for (const type of Object.keys(a)) assert.ok(a[type] >= 0.85, `${type} F1 ${a[type]}`);
	});
	it("drops hidden text, cookie banners, navigation and footers", () => {
		const out = extractHtml(pages[0].html, "https://example.com/").markdown;
		assert.doesNotMatch(out, /Ignore all previous instructions/);
		assert.doesNotMatch(out, /cookies/i);
		assert.doesNotMatch(out, /Privacy/);
		assert.match(out, /bus network/);
	});
	it("drops elements marked hidden or aria-hidden", () => {
		const out = extractHtml('<main><h1>T</h1><p>' + "visible ".repeat(30) + '</p><p hidden>SECRETONE</p><div aria-hidden="true">SECRETTWO</div></main>', "https://e.com/").markdown;
		assert.doesNotMatch(out, /SECRET/);
		assert.match(out, /visible/);
	});
	it("keeps tables as markdown and resolves links", () => {
		const out = extractHtml('<main><h1>T</h1><p>See <a href="/x">this</a> and more words here.</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></main>', "https://e.com/p");
		assert.match(out.markdown, /\[this\]\(https:\/\/e\.com\/x\)/);
		assert.match(out.markdown, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
	});
});

describe("local extract provider", () => {
	const dir = mkdtempSync(join(tmpdir(), "local-extract-"));
	const make = (name: string, body: string | Buffer, contentType: string, suffix: string) => {
		const path = join(dir, name);
		writeFileSync(path, body);
		return createLocalExtractProvider(DEFAULT_SETTINGS.local, { capture: async (url) => ({ url, path, suffix, digest: "d", bytes: 1, contentType, capturedAt: "t" }) });
	};
	it("declines a thin client-rendered page so the chain falls through", async () => {
		const p = make("spa.html", "<html><body><div id=root></div><script>x</script></body></html>", "text/html", ".html");
		assert.equal((await p.extract!("https://e.com/spa")).content, "");
	});
	it("extracts a real page", async () => {
		const long = "<main><h1>Title</h1>" + "<p>" + "word ".repeat(120) + "</p></main>";
		const out = await make("a.html", `<html><head><title>Hi</title></head><body>${long}</body></html>`, "text/html", ".html").extract!("https://e.com/a");
		assert.equal(out.provider, "local");
		assert.ok(out.wordCount >= 100);
	});
	it("a text PDF is read from its text layer with page markers, a scanned one is declined", { skip: !hasPdftotext }, async () => {
		const lines = (t: string, n: number) => Array.from({ length: n }, (_, i) => `BT /F1 10 Tf 20 ${760 - i * 12} Td (${t} line ${i}) Tj ET`).join("\n");
		const pdf = (t: string, n: number) => {
			const body = lines(t, n);
			return `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
		};
		const ok = await make("t.pdf", Buffer.from(pdf("Quarterly revenue rose 12.5 percent", 40)), "application/pdf", ".pdf").extract!("https://e.com/t.pdf");
		assert.match(ok.content, /^\[page 1\]/);
		assert.match(ok.content, /12\.5 percent/);
		const thin = await make("s.pdf", Buffer.from(pdf("x", 1)), "application/pdf", ".pdf").extract!("https://e.com/s.pdf");
		assert.equal(thin.content, "");
	});
});
