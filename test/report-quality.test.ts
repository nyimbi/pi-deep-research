import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkLabelTerms, checkMechanism, diagramLabels } from "../src/report-quality.ts";

const para = "The retry loop drains a bounded queue one request at a time, so a slow upstream cannot grow memory without limit, and each attempt waits twice as long as the last.";
const HOW = `## How it works\n\n${para}\n\n${para}\n\n${para}\n\n## Next\n\nx\n`;

describe("checkMechanism", () => {
	it("asks deep and exhaustive reports for a mechanism section and skips shallower depths", () => {
		assert.match(checkMechanism("## Findings\n\nx\n", "deep")[0]!, /no section explains how the subject works/);
		assert.match(checkMechanism("## Findings\n\nx\n", "exhaustive")[0]!, /no section/);
		assert.deepEqual(checkMechanism("## Findings\n\nx\n", "standard"), []);
		assert.deepEqual(checkMechanism("## Findings\n\nx\n", "quick"), []);
	});
	it("passes three explanatory paragraphs and flags a thin section, counting bullets as not prose", () => {
		assert.deepEqual(checkMechanism(HOW, "deep"), []);
		assert.match(checkMechanism(`## How it works\n\n${para}\n\n- a\n- b\n`, "deep")[0]!, /has 1 explanatory paragraph/);
		assert.deepEqual(checkMechanism(`## Mechanism\n\n${para}\n\n${para}\n\n${para}\n`, "deep"), []);
	});
});

describe("diagram labels against the prose", () => {
	const flow = "```mermaid\nflowchart LR\n  A[Retry queue] --> B{Backoff gate}\n  B --> C[(Dead letter store)]\n```\n";
	it("reads labels from nodes, decisions, stores and subgraph titles", () => {
		assert.deepEqual(diagramLabels("flowchart LR\n  A[Retry queue] --> B{Backoff gate}\n  B --> C[(Dead letter store)]\n  subgraph S [Edge tier]\n  A\n  end"), ["Retry queue", "Backoff gate", "Dead letter store", "Edge tier"]);
	});
	it("passes when the prose uses each label's words and flags a label it never mentions", () => {
		assert.deepEqual(checkLabelTerms(`## A\n\nThe retry queue feeds a backoff gate and then a dead letter store.\n\n${flow}`), []);
		const out = checkLabelTerms(`## A\n\nThe retry queue feeds a gate.\n\n${flow}`);
		assert.equal(out.length, 1);
		assert.match(out[0]!, /diagram 1 labels "Dead letter store"/);
		assert.ok(!out[0]!.includes("Retry queue"));
	});
	it("does not count the diagram's own text as prose", () => {
		assert.equal(checkLabelTerms(`## A\n\nNothing here.\n\n${flow}`).length, 1);
	});
});
