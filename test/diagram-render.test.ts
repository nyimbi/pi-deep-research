import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { createMmdcRenderer, MERMAID_THEME } from "../src/diagram-render.ts";
import { LIGHT } from "../src/diagram-style.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const hasMmdc = (() => { try { execFileSync("mmdc", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe("mmdc renderer", { skip: !hasMmdc, timeout: 120_000 }, () => {
	const render = createMmdcRenderer(DEFAULT_SETTINGS.diagrams);
	it("renders a valid diagram to SVG", async () => {
		const out = await render("flowchart LR\n  A[Search] -->|reads| B[Extract]");
		assert.equal(out.error, undefined);
		assert.match(out.svg ?? "", /<svg/);
	});
	it("reports a parse error the structural check cannot see", async () => {
		const out = await render("flowchart LR\n  A -->|reads B\n  C --- ");
		assert.equal(out.svg, undefined);
		assert.ok(out.error && out.error.length > 0);
	});
	it("reports a missing binary instead of throwing", async () => {
		const out = await createMmdcRenderer({ ...DEFAULT_SETTINGS.diagrams, mmdc: "mmdc-does-not-exist" })("flowchart LR\n A-->B");
		assert.ok(out.error);
		assert.equal(out.unavailable, true);
	});
	it("a parse error is not marked unavailable", async () => {
		assert.equal((await render("flowchart LR\n  A -->|reads B\n  C --- ")).unavailable, undefined);
	});
});

describe("charts keep one accent", () => {
	const v = MERMAID_THEME.themeVariables as Record<string, unknown>;
	it("gives the first pie slice and the first plotted series the accent, and the rest ink tints at full opacity", () => {
		assert.equal(v.pie1, LIGHT.accent);
		for (const k of ["pie2", "pie3", "pie4", "pie5", "pie6"]) assert.notEqual(v[k], LIGHT.accent);
		assert.equal(v.pieOpacity, "1");
		assert.match((v.xyChart as { plotColorPalette: string }).plotColorPalette, new RegExp(`^${LIGHT.accent},`));
	});
});
