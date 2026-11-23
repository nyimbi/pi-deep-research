import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeFindings, registrableDomain } from "../src/grade.ts";
import { SourceLedger } from "../src/ledger.ts";

function ledgerOf(urls: string[], extract = true): SourceLedger {
	const ledger = new SourceLedger();
	ledger.recordSearch("searxng", "q", urls.map((url) => ({ title: "T", url, snippet: "s" })));
	if (extract) for (const url of urls) ledger.recordExtract(url, { title: "T", url, content: "body text here", wordCount: 3, provider: "tavily" });
	return ledger;
}
const report = (...lines: string[]) => `## Findings\n\n${lines.join("\n")}\n\n## Gaps\n\n- g\n`;

describe("registrableDomain", () => {
	it("collapses subdomains and handles co.uk style suffixes", () => {
		assert.equal(registrableDomain("https://www.a.example.com/x"), "example.com");
		assert.equal(registrableDomain("https://news.bbc.co.uk/x"), "bbc.co.uk");
		assert.equal(registrableDomain("https://example.com/x"), "example.com");
	});
});

describe("gradeFindings", () => {
	it("two findings on one domain grade lower than two on independent domains", () => {
		const one = ledgerOf(["https://blog.example.com/a", "https://docs.example.com/b"]);
		const two = ledgerOf(["https://blog.example.com/a", "https://other.example.org/b"]);
		const single = gradeFindings(report("- A ([a](https://blog.example.com/a), [b](https://docs.example.com/b))"), one).findings[0];
		const multi = gradeFindings(report("- A ([a](https://blog.example.com/a), [b](https://other.example.org/b))"), two).findings[0];
		assert.deepEqual([single.grade, single.domains.length], ["very-low", 1]);
		assert.deepEqual([multi.grade, multi.domains.length], ["low", 2]);
	});

	it("a primary-tier source with corroboration is high; overall is the minimum", () => {
		const ledger = ledgerOf(["https://www.nasa.gov/a", "https://arxiv.org/abs/1", "https://blog.example.com/c"]);
		const r = gradeFindings(report("- Strong ([n](https://www.nasa.gov/a), [x](https://arxiv.org/abs/1))", "- Weak ([c](https://blog.example.com/c))"), ledger);
		assert.deepEqual(r.findings.map((f) => f.grade), ["high", "very-low"]);
		assert.equal(r.overall, "very-low");
	});

	it("a finding whose sources were never extracted is very-low", () => {
		const r = gradeFindings(report("- Claim ([a](https://www.nasa.gov/a))"), ledgerOf(["https://www.nasa.gov/a"], false));
		assert.deepEqual([r.findings[0].grade, r.findings[0].reason], ["very-low", "no cited source was extracted"]);
	});

	it("returns no overall grade when Findings cites nothing", () => {
		assert.deepEqual(gradeFindings(report("- plain text"), new SourceLedger()), { findings: [], overall: null });
	});
});
