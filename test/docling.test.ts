import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createDoclingProvider, doclingArgs } from "../src/native/docling.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const hasDocling = (() => { try { execFileSync("docling", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const dir = mkdtempSync(join(tmpdir(), "docling-test-"));
const cap = (path: string, contentType: string, suffix: string) => async (url: string) => ({ url, path, suffix, digest: "d", bytes: 1, contentType, capturedAt: "t" });

describe("docling provider", () => {
	it("is off by default", () => {
		assert.equal(createDoclingProvider(DEFAULT_SETTINGS.docling, { capture: cap("x", "", "") }).isConfigured(), false);
	});
	it("builds standard-pipeline arguments, and a VLM preset replaces the pipeline", () => {
		const std = doclingArgs(DEFAULT_SETTINGS.docling, "in.pdf", "out");
		assert.deepEqual(std.slice(-1), ["in.pdf"]);
		assert.ok(std.includes("--device") && std.includes("cpu"));
		assert.ok(!std.includes("--pipeline"));
		const vlm = doclingArgs({ ...DEFAULT_SETTINGS.docling, vlmModel: "granite_docling" }, "in.pdf", "out");
		assert.ok(vlm.join(" ").includes("--pipeline vlm --vlm-model granite_docling"));
		assert.ok(doclingArgs({ ...DEFAULT_SETTINGS.docling, ocr: false }, "in.pdf", "out").includes("--no-ocr"));
	});
	it("reads the Markdown the command wrote, and never runs it for a web page", async () => {
		const fake = join(dir, "fake-docling");
		writeFileSync(fake, '#!/bin/sh\nout=""\nwhile [ $# -gt 1 ]; do [ "$1" = "--output" ] && out="$2"; shift; done\nprintf "# Heading\\n\\n| a | b |\\n| - | - |\\n| 1 | 2 |\\n" > "$out/doc.md"\n');
		chmodSync(fake, 0o755);
		const settings = { ...DEFAULT_SETTINGS.docling, enabled: true, command: fake };
		const doc = await createDoclingProvider(settings, { capture: cap(fake, "application/pdf", ".pdf") }).extract!("https://e.com/r.pdf");
		assert.match(doc.content, /\| a \| b \|/);
		assert.equal(doc.provider, "docling");
		const page = await createDoclingProvider(settings, { capture: cap(fake, "text/html", ".html") }).extract!("https://e.com/p");
		assert.equal(page.content, "");
	});
	it("a failing command rejects so the chain moves on", async () => {
		const bad = join(dir, "bad-docling");
		writeFileSync(bad, "#!/bin/sh\nexit 3\n");
		chmodSync(bad, 0o755);
		await assert.rejects(createDoclingProvider({ ...DEFAULT_SETTINGS.docling, enabled: true, command: bad }, { capture: cap(bad, "application/pdf", ".pdf") }).extract!("https://e.com/r.pdf"));
	});
	it("converts a real PDF with the installed docling", { skip: !hasDocling, timeout: 240_000 }, async () => {
		const body = Array.from({ length: 30 }, (_, i) => `BT /F1 10 Tf 20 ${760 - i * 12} Td (Quarterly revenue rose 12.5 percent line ${i}) Tj ET`).join("\n");
		const path = join(dir, "real.pdf");
		writeFileSync(path, `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
		const out = await createDoclingProvider({ ...DEFAULT_SETTINGS.docling, enabled: true, ocr: false }, { capture: cap(path, "application/pdf", ".pdf") }).extract!("https://e.com/real.pdf");
		assert.match(out.content, /12\.5 percent/);
	});
});
