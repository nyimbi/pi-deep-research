import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDiagrams, embedRenderedDiagrams, lintDiagrams, mermaidBlocks } from "../src/diagrams.ts";
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
		assert.match(checkDiagrams(fence("flowchart LR\n  A[Cut 45.5%] --> B[Done]"), ledger())[0], /shows figures but names no source/);
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

	describe("charts backed by a table", () => {
		const table = "\n| Provider | Share |\n|---|---|\n| Alpha | 45.5% |\n| Beta | 54.5% |\n";
		const pie = (a: string, b: string) => fence(`pie title Share\n  "Alpha" : ${a}\n  "Beta" : ${b}`) + table;
		it("passes a pie whose every slice is a table row, with no separate source", () => {
			assert.deepEqual(checkDiagrams(pie("45.5", "54.5"), ledger()), []);
		});
		it("fails a slice whose value differs from its row, and a slice whose label has no row", () => {
			const wrong = checkDiagrams(pie("45.5", "50"), ledger());
			assert.equal(wrong.length, 1);
			assert.match(wrong[0], /Beta = 50, which matches no row/);
			assert.match(checkDiagrams(fence('pie title S\n  "Gamma" : 45.5') + table, ledger())[0], /Gamma = 45.5/);
		});
		it("fails a chart when the report has no table", () => {
			assert.match(checkDiagrams(fence('pie title S\n  "Alpha" : 45.5'), ledger())[0], /no table to back/);
		});
		it("pairs xychart-beta categories with values by position", () => {
			const chart = (vals: string) => fence(`xychart-beta\n  title "Share"\n  x-axis [Alpha, Beta]\n  bar [${vals}]`) + table;
			assert.deepEqual(checkDiagrams(chart("45.5, 54.5"), ledger()), []);
			assert.match(checkDiagrams(chart("54.5, 45.5"), ledger())[0], /Alpha = 54.5/);
		});
		it("a value with no category cannot be backed", () => {
			const extra = fence("xychart-beta\n  x-axis [Alpha]\n  bar [45.5, 54.5]") + table;
			assert.match(checkDiagrams(extra, ledger())[0], /no category 2/);
		});
		it("a value sitting in a different row does not back the point", () => {
			const swapped = fence('pie title S\n  "Alpha" : 54.5\n  "Beta" : 45.5') + table;
			assert.equal(checkDiagrams(swapped, ledger()).length, 2);
		});
	});
});

describe("lintDiagrams", () => {
	const cap = "The pipeline moves each request through three stages in order.";
	const body = (b: string, c = cap) => `Text.\n\n${c}\n\n\`\`\`mermaid\n${b}\n\`\`\`\n`;
	it("is quiet for a captioned diagram with labelled arrows", () => {
		assert.deepEqual(lintDiagrams(body("flowchart LR\n  A -->|reads| B\n  B -->|writes| C")), []);
	});
	it("flags a missing caption, and accepts a caption after the block", () => {
		assert.match(lintDiagrams("Hi.\n\n```mermaid\nflowchart LR\n  A -->|x| B\n```\n\n## Next\n")[0], /no caption/);
		assert.deepEqual(lintDiagrams("Hi.\n\n```mermaid\nflowchart LR\n  A -->|x| B\n```\n\nRequests flow from A to B here.\n"), []);
	});
	it("flags a flowchart where most arrows are unlabelled, counting the three label spellings as labelled", () => {
		assert.match(lintDiagrams(body("flowchart LR\n  A --> B --> C\n  C --> D"))[0], /labels 0 of 3 arrows/);
		assert.match(lintDiagrams(body("flowchart LR\n  A -.-> B\n  B ==> C\n  C -. x .-> D\n  D -.-> E"))[0], /labels 1 of 4 arrows/);
		for (const spelling of ["A -- reads --> B\n  B -- writes --> C", "A ==>|reads| B\n  B ==>|writes| C", "A -. polls .-> B\n  B -. reads .-> C", "A == reads ==> B\n  B == writes ==> C", "A -->|reads| B\n  B ---|joins| C"]) {
			assert.deepEqual(lintDiagrams(body(`flowchart LR\n  ${spelling}`)), [], spelling);
		}
	});
	it("flags a sequence message with no text and a Comparison section with no diagram", () => {
		assert.match(lintDiagrams(body("sequenceDiagram\n  A->>B: hello\n  B->>A"))[0], /1 message\(s\) with no text/);
		assert.match(lintDiagrams("# R\n\n## Comparison\n\nA vs B.\n")[0], /Comparison section has no diagram/);
	});
});


describe("template examples", () => {
	it("every Mermaid block in the report template passes the structural check and the lint", async () => {
		const { readFile } = await import("node:fs/promises");
		const template = await readFile(new URL("../references/report-template.md", import.meta.url), "utf8");
		const blocks = mermaidBlocks(template);
		assert.ok(blocks.length >= 1, "the template carries at least one example");
		assert.deepEqual(checkDiagrams(template, ledger()), []);
		assert.deepEqual(lintDiagrams(template.replace(/## Comparison[^\n]*/g, "## Comparisons")), []);
	});
});

describe("diagram density, repeats and embedding", () => {
	const chain = (n: number) => "flowchart LR\n" + Array.from({ length: n - 1 }, (_, i) => `  N${i} -->|step| N${i + 1}`).join("\n");
	const cap = "This drawing shows the request path through each stage in order.";
	it("warns past 9 nodes, not at 9", () => {
		assert.match(lintDiagrams(`${cap}\n\n\`\`\`mermaid\n${chain(10)}\n\`\`\``).join("\n"), /10 nodes/);
		assert.deepEqual(lintDiagrams(`${cap}\n\n\`\`\`mermaid\n${chain(9)}\n\`\`\``), []);
	});
	it("warns past 12 arrows", () => {
		const many = "flowchart LR\n" + Array.from({ length: 13 }, (_, i) => `  A -->|e${i}| B`).join("\n");
		assert.match(lintDiagrams(`${cap}\n\n\`\`\`mermaid\n${many}\n\`\`\``).join("\n"), /13 arrows/);
		assert.ok(!lintDiagrams(`${cap}\n\n\`\`\`mermaid\n${many.split("\n").slice(0, 13).join("\n")}\n\`\`\``).some((w) => /arrows; past/.test(w)));
	});
	it("counts nodes on chained arrows and ignores repeated ids", () => {
		const src = "flowchart LR\n  A -->|x| B -->|y| C\n  A -->|z| C";
		assert.deepEqual(lintDiagrams(`${cap}\n\n\`\`\`mermaid\n${src}\n\`\`\``), []);
	});
	it("flags a diagram repeated verbatim", () => {
		const one = `${cap}\n\n\`\`\`mermaid\nflowchart LR\n  A -->|x| B\n\`\`\``;
		assert.match(lintDiagrams(`${one}\n\n${one}`).join("\n"), /diagram 2 repeats diagram 1/);
	});
	it("links an image after exactly the diagrams that rendered", () => {
		const b = (t: string) => `\`\`\`mermaid\nflowchart LR\n  A -->|${t}| B\n\`\`\``;
		const out = embedRenderedDiagrams(`x\n\n${b("1")}\n\nmid\n\n${b("2")}\n\nend`, [2]);
		assert.ok(!out.includes("diagram-1.svg"));
		assert.equal(out.match(/!\[Diagram 2\]\(diagrams\/diagram-2\.svg\)/g)?.length, 1);
		assert.ok(out.indexOf("diagram-2.svg") > out.lastIndexOf("-->|2|"));
		assert.equal(embedRenderedDiagrams("no diagrams", [1]), "no diagrams");
	});
	it("uses the caption as the image alt text, with brackets removed", () => {
		const r = "Latency fell [sharply] after the queue was added to the path.\n\n```mermaid\nflowchart LR\n  A -->|x| B\n```\n";
		assert.match(embedRenderedDiagrams(r, [1]), /!\[Latency fell sharply after the queue was added to the path\.\]\(diagrams\/diagram-1\.svg\)/);
	});
});
