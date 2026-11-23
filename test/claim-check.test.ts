import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkClaims } from "../src/claim-check.ts";

const url = "https://example.com/spec";
const sources: Record<string, string> = {
	[url]: "The connector times out after 30 seconds. Latency was 12.5% lower, with 1,200 requests in 2024. The authors write: the retry budget must never exceed two attempts.",
};
const lookup = (u: string) => sources[u];
const check = (text: string) => checkClaims(`## Findings\n\n${text}\n\n## Sources\n\n- [x](${url}) 9999\n`, lookup);

describe("checkClaims", () => {
	it("passes numbers and quotes that are in the cited source", () => {
		assert.deepEqual(check(`- Latency fell 12.5% across 1200 requests in 2024 ([spec](${url})).`), []);
		assert.deepEqual(check(`- The spec says "the retry budget must never exceed two attempts" (${url}).`), []);
	});

	it("flags a wrong percentage, a wrong count and a fabricated quote", () => {
		const issues = check(`- Latency fell 15.5% ([spec](${url})).\n- It served 1,300 requests (${url}).\n- The spec says "retries are unlimited under load" (${url}).`);
		assert.deepEqual(issues.map((i) => [i.kind, i.token]), [["number", "15.5%"], ["number", "1300"], ["quote", "retries are unlimited under load"]]);
	});

	it("ignores small bare integers, the Sources section, uncited and derived sentences", () => {
		assert.deepEqual(check(`- Two retries and 7 workers (${url}).`), []);
		assert.deepEqual(check("- Latency fell 99.9% with no citation."), []);
		assert.deepEqual(check(`- Total 4,321 requests (derived) (${url}).`), []);
		assert.deepEqual(check(`- Total 4,321 requests (derived: total) (${url}).`), []);
	});

	it("does not read digits out of the URL itself", () => {
		assert.deepEqual(checkClaims("- See [spec](https://example.com/doc/123456).", () => "no digits here"), []);
	});

	it("skips a sentence whose cited source was never extracted", () => {
		assert.deepEqual(checkClaims("- It grew 77% (https://example.com/missing).", () => undefined), []);
	});

	it("does not match a number inside a longer one", () => {
		assert.equal(check(`- Saw 200 requests (${url}).`).length, 1);
		assert.equal(check(`- Saw 1.5% fewer (${url}).`).length, 1);
	});
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceLedger } from "../src/ledger.ts";
import { writeResearchPackage } from "../src/research-package.ts";

describe("claim checks in research_finalize", () => {
	const ledger = () => {
		const l = new SourceLedger();
		l.recordSearch("searxng", "q", [{ title: "Spec", url, snippet: "s" }]);
		l.recordExtract(url, { title: "Spec", url, content: sources[url], wordCount: 30, provider: "tavily" });
		return l;
	};
	const report = (finding: string) => `# T\n\n## Question\n\nq\n\n## Findings\n\n- ${finding} ([spec](${url}))\n\n## Decisions\n\n- d\n\n## Rejected options\n\n- r\n\n## Confidence\n\n- high\n\n## Gaps\n\n- Only one source was available.\n\n## Scope\n\n- In scope: the connector timeout.\n- Out of scope: retry jitter.\n\n## Contradictions\n\n- None found after checking 1 source.\n\n## Sources\n\nSee [spec](${url}).\n`;

	it("fails a planted wrong number and passes the right one", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-claim-"));
		try {
			const base = { cwd, slug: "claim-check-run", question: "q", depth: "standard", ledger: ledger(), archiveRoot: "docs/research" };
			const bad = await writeResearchPackage({ ...base, report: report("Latency fell 15.5%.") });
			assert.ok(bad.errors.some((e) => e.startsWith("claim check: number \"15.5%\"")));
			const good = await writeResearchPackage({ ...base, report: report("Latency fell 12.5%.") });
			assert.deepEqual(good.errors, []);
			const soft = await writeResearchPackage({ ...base, report: report("Latency fell 15.5%."), strict: false });
			assert.deepEqual(soft.errors, []);
			assert.ok(soft.warnings.some((w) => w.startsWith("claim check:")));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("warns when declared confidence exceeds the cap set by the weakest finding", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-grade-"));
		try {
			const base = { cwd, slug: "grade-check-run", question: "q", depth: "standard", ledger: ledger(), archiveRoot: "docs/research", report: report("Latency fell 12.5%.") };
			const high = await writeResearchPackage({ ...base, confidence: 90 });
			assert.ok(high.warnings.some((w) => w.startsWith("declared confidence 90 exceeds the 40 cap")));
			assert.ok(high.warnings.some((w) => w.startsWith("very-low evidence:")));
			assert.equal(high.evidenceGrade.overall, "very-low");
			const ok = await writeResearchPackage({ ...base, confidence: 35 });
			assert.ok(!ok.warnings.some((w) => w.startsWith("declared confidence")));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("calc blocks in research_finalize", () => {
	const ledger = () => {
		const l = new SourceLedger();
		l.recordSearch("searxng", "q", [{ title: "Spec", url, snippet: "s" }]);
		l.recordExtract(url, { title: "Spec", url, content: sources[url], wordCount: 30, provider: "tavily" });
		return l;
	};
	const report = (calc: string, prose: string) => `# T\n\n## Question\n\nq\n\n## Findings\n\n- Latency is lower ([spec](${url})).\n\n\`\`\`calc\n${calc}\n\`\`\`\n\n${prose}\n\n## Decisions\n\n- d\n\n## Rejected options\n\n- r\n\n## Confidence\n\n- high\n\n## Gaps\n\n- Only one source was available.\n\n## Scope\n\n- In scope: the connector timeout.\n- Out of scope: retry jitter.\n\n## Contradictions\n\n- None found after checking 1 source.\n\n## Sources\n\nSee [spec](${url}).\n`;
	const GOOD = `lat = 12.5 @ ${url}\nreqs = 1200 @ ${url}\nper = lat * reqs / 100`;
	it("fails a wrong input and a wrong derived number in a strict run, warns when not strict, and passes the right ones", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-calc-"));
		try {
			const base = { cwd, slug: "calc-run", question: "q", depth: "standard", ledger: ledger(), archiveRoot: "docs/research" };
			const good = await writeResearchPackage({ ...base, report: report(GOOD, "That is 150 requests saved (derived: per).") });
			assert.deepEqual(good.errors, []);
			const html = await (await import("node:fs/promises")).readFile(join(cwd, "docs/research/calc-run/report.html"), "utf8");
			assert.match(html, /<th>Calculation<\/th>[\s\S]*<td>per<\/td><td style="text-align:right">150<\/td>/);
			const wrongInput = await writeResearchPackage({ ...base, report: report(GOOD.replace("12.5", "13.5"), "That is 162 requests saved (derived: per).") });
			assert.ok(wrongInput.errors.some((e) => /calc block 1: input "lat" is 13\.5, which does not appear/.test(e)));
			const wrongProse = await writeResearchPackage({ ...base, report: report(GOOD, "That is 151 requests saved (derived: per).") });
			assert.ok(wrongProse.errors.some((e) => /derived: per does not print 150/.test(e)));
			const soft = await writeResearchPackage({ ...base, report: report(GOOD, "That is 151 requests saved (derived: per)."), strict: false });
			assert.deepEqual(soft.errors, []);
			assert.ok(soft.warnings.some((w) => /derived: per does not print 150/.test(w)));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
