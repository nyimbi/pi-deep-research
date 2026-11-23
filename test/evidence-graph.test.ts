import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { checkDiagrams } from "../src/diagrams.ts";
import { createMmdcRenderer } from "../src/diagram-render.ts";
import { evidenceGraph } from "../src/evidence-graph.ts";
import { SourceLedger } from "../src/ledger.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const hasMmdc = (() => { try { execFileSync("mmdc", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const A = "https://docs.example.com/spec";
const B = "https://news.other.org/story";

function ledger(): SourceLedger {
	const l = new SourceLedger();
	l.recordSearch("t", "q", [{ title: "A", url: A, snippet: "s" }, { title: "B", url: B, snippet: "s" }]);
	l.recordExtract(A, { title: "A", url: A, content: "text", wordCount: 1, provider: "t" });
	return l;
}
const report = `# R\n\n## Findings\n\n- It times out [F1] ([a](${A}))\n- It is reported [F2] ([a](${A})) ([b](${B}))\n- Unlinked claim with no url\n\n## Gaps\n\nx\n`;

describe("evidenceGraph", () => {
	it("draws one node per cited finding, one per domain, and an edge saying tier and whether it was read", () => {
		const g = evidenceGraph(report, ledger())!;
		assert.match(g, /^flowchart LR/);
		assert.match(g, /f0\["F1 \(/);
		assert.match(g, /f1\["F2 \(/);
		assert.ok(!g.includes("Unlinked"));
		assert.equal((g.match(/\[\("/g) ?? []).length, 2, "docs.example.com and other.org");
		assert.match(g, /-->\|tier \d, read\| d0/);
		assert.match(g, /-->\|tier \d, not read\| d1/);
		assert.equal((g.match(/f1 -->/g) ?? []).length, 2);
	});
	it("returns null when the Findings section cites nothing, or is absent", () => {
		assert.equal(evidenceGraph("# R\n\n## Findings\n\n- no link\n", ledger()), null);
		assert.equal(evidenceGraph("# R\n\nnothing\n", ledger()), null);
	});
	it("is a diagram the report's own checker accepts", () => {
		const g = evidenceGraph(report, ledger())!;
		assert.deepEqual(checkDiagrams("```mermaid\n" + g + "\n```\n", ledger()), []);
	});
	it("renders with mmdc", { skip: !hasMmdc, timeout: 90_000 }, async () => {
		const out = await createMmdcRenderer(DEFAULT_SETTINGS.diagrams)(evidenceGraph(report, ledger())!);
		assert.equal(out.error, undefined);
		assert.match(out.svg ?? "", /<svg/);
	});
});
