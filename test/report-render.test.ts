import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderReportPage } from "../src/report-html.ts";
import { checkReportPage, findChrome, printReportPdf } from "../src/report-render.ts";

const chrome = findChrome();
const page = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>${body}</body></html>`;

describe("report page checks in headless Chrome", { skip: chrome ? false : "no Chrome on this machine" }, () => {
	it("passes a plain page and the real report page at both widths", async () => {
		assert.deepEqual(await checkReportPage(chrome!, page("<p>hi</p>")), []);
		const real = renderReportPage("# T\n\n## A\n\nText.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n", { colophon: [{ label: "Depth", value: "deep" }] });
		assert.deepEqual(await checkReportPage(chrome!, real.html), []);
	});
	it("fails sideways overflow, a broken image and a script error, each once", async () => {
		const wide = await checkReportPage(chrome!, page('<div style="width:2000px">x</div>'));
		assert.equal(wide.length, 2);
		assert.match(wide[0]!, /overflows sideways at 1280px/);
		assert.deepEqual(await checkReportPage(chrome!, page('<img alt="nope" src="data:image/png;base64,AAAA">')), ["report.html has an image that did not load: nope"]);
		assert.deepEqual(await checkReportPage(chrome!, page("<script>throw new Error('boom')</script>")), ["report.html raised a script error: Uncaught Error: boom"]);
	});
	it("prints a pdf from the page", async () => {
		const dir = await mkdtemp(join(tmpdir(), "report-pdf-"));
		try {
			const html = join(dir, "r.html");
			await (await import("node:fs/promises")).writeFile(html, renderReportPage("# T\n\n## A\n\nText.\n").html);
			assert.equal(await printReportPdf(chrome!, html, join(dir, "r.pdf")), null);
			assert.equal((await readFile(join(dir, "r.pdf"))).subarray(0, 5).toString(), "%PDF-");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
