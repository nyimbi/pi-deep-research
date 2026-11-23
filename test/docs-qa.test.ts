import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createDocsQaRunner } from "../src/docs-qa.ts";
import { SourceLedger } from "../src/ledger.ts";
import { writeResearchPackage } from "../src/research-package.ts";

const dirs: string[] = [];
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const url = "https://example.com/spec";
const REPORT = (extra: string) => `# Timeout policy

## Question

What timeout should the connector use?

## Findings

- Thirty seconds with two retries fits the observed tail.${extra}

## Decisions

- Use 30 s and two retries.

## Rejected options

- Infinite retry: amplification.

## Confidence

- Level: high

## Gaps

- Only one source was available.

## Scope

- In scope: the connector timeout.
- Out of scope: retry jitter.

## Contradictions

- None found after checking 1 source.

## Sources

See [the specification](${url}).
`;

function ledger(): SourceLedger {
	const l = new SourceLedger();
	l.recordSearch("searxng", "q", [{ title: "Spec", url, snippet: "s" }]);
	l.recordExtract(url, { title: "Spec", url, content: "thirty seconds", wordCount: 2, provider: "tavily" });
	return l;
}

async function finalize(report: string, over: Record<string, unknown> = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "pi-docsqa-"));
	dirs.push(cwd);
	return writeResearchPackage({
		cwd, slug: "docs-qa-check", question: "q", depth: "standard", report, ledger: ledger(), archiveRoot: "docs/research",
		docsQa: createDocsQaRunner(), ...over,
	});
}

describe("docs-qa gate in research_finalize", () => {
	it("passes a clean report", async () => {
		const result = await finalize(REPORT(""));
		assert.deepEqual(result.errors, []);
	});

	it("fails a report with an em dash and names the rule and line", async () => {
		const result = await finalize(REPORT(" It is fast — mostly."));
		assert.equal(result.errors.length, 1);
		assert.match(result.errors[0], /^docs-qa TY001 README\.md:\d+ em dash/);
	});

	it("downgrades findings to warnings when strict is false", async () => {
		const result = await finalize(REPORT(" It is fast — mostly."), { strict: false });
		assert.deepEqual(result.errors, []);
		assert.ok(result.warnings.some((w) => w.includes("TY001")));
	});

	it("fails closed when the gate cannot run", async () => {
		const result = await finalize(REPORT(""), { docsQa: createDocsQaRunner("/nonexistent/python3") });
		assert.equal(result.errors.length, 1);
		assert.match(result.errors[0], /docs-qa did not run/);
	});
});
