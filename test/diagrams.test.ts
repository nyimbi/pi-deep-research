import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDiagrams, mermaidBlocks } from "../src/diagrams.ts";
import { SourceLedger } from "../src/ledger.ts";

const ledger = () => {
	const l = new SourceLedger();
	l.recordSearch("t", "q", [{ title: "A", url: "https://a.example/x", snippet: "s" }]);
	l.recordExtract("https://a.example/x", { title: "A", url: "https://a.example/x", content: "The pipeline cut latency by 42.5% across 1200 requests.", wordCount: 9, provider: "t" });
	return l;
};
const fence = (body: string) => `Intro.\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nOutro.`;

describe("checkDiagrams", () => {
	it("passes a well formed diagram whose figures are in the named source", () => {
		const r = fence("flowchart LR\n  %% source: https://a.example/x\n  A[Before] -->|cut 42.5%| B[After: 1200 requests]");
		assert.deepEqual(checkDiagrams(r, ledger()), []);
	});
	it("fails a figure the named source does not contain", () => {
		const r = fence("flowchart LR\n  %% source: https://a.example/x\n  A[Before] -->|cut 77.7%| B[After]");
		const out = checkDiagrams(r, ledger());
		assert.equal(out.length, 1);
		assert.match(out[0], /diagram 1: .*77\.7%/);
	});
	it("fails figures with no source, and a source the tools never returned", () => {
		assert.match(checkDiagrams(fence("pie title Share\n  \"A\" : 45.5\n  \"B\" : 54.5"), ledger())[0], /shows figures but names no source/);
		assert.match(checkDiagrams(fence("flowchart LR\n  %% source: https://evil.example/z\n  A --> B"), ledger())[0], /never returned/);
	});
	it("allows a purely structural diagram with no source", () => {
		assert.deepEqual(checkDiagrams(fence("flowchart TD\n  A[Search] --> B[Extract] --> C[Verify]"), ledger()), []);
	});
	it("rejects an unknown type, an unbalanced bracket and an unterminated quote", () => {
		assert.match(checkDiagrams(fence("notadiagram\n  A --> B"), ledger())[0], /not a Mermaid diagram type/);
		assert.match(checkDiagrams(fence("flowchart TD\n  A[Search --> B"), ledger())[0], /unclosed|unbalanced/);
		assert.match(checkDiagrams(fence('flowchart TD\n  A["Search --> B'), ledger())[0], /unterminated quote/);
	});
	it("numbers in node ids and brackets inside quotes are not errors", () => {
		assert.deepEqual(checkDiagrams(fence('flowchart TD\n  N100["Step (one"] --> N200[Next]'), ledger()), []);
	});
	it("numbers each block and finds several", () => {
		const r = fence("flowchart TD\n  A-->B") + "\n\n" + fence("sequenceDiagram\n  A->>B: hi");
		assert.equal(mermaidBlocks(r).length, 2);
	});
});
