import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { styleForPackage } from "../src/diagram-style.ts";
import { SourceLedger } from "../src/ledger.ts";
import { checkReportPage, findChrome } from "../src/report-render.ts";
import { writeResearchPackage } from "../src/research-package.ts";

const SOURCES: Record<string, { title: string; content: string }> = {
	"https://example.org/latency-study": {
		title: "Latency study",
		content: "In the 2025 field study the p99 latency of the connector was 1,830 ms across four regions.\n\nRetries beyond the second attempt added 12% to tail latency without improving success, so the authors cap retries at two.\n\nThe queue was bounded at 64 requests and drained one request at a time so memory stayed flat under a slow upstream.",
	},
	"https://example.org/managed-queue": { title: "Managed queue docs", content: "Each queue accepts up to 3,000 messages per second. Add queues to scale beyond that limit.\n\nMessages are retained for four days by default and delivered at least once." },
	"https://example.org/broker-benchmark": { title: "Broker benchmark", content: "On a three-node cluster the broker sustained 48,000 messages per second with replication on.\n\nThe vendor ran the benchmark with small payloads on dedicated hardware." },
	"https://example.org/capacity-report": { title: "Capacity report", content: "Ingest peaked at 420 messages per second during the last quarter, on the busiest day of the month.\n\nAverage load was far lower, at about 90 messages per second." },
	"https://example.org/sre-guide": {
		title: "SRE guide",
		content: "Reliability budgets suggest the user-facing deadline be set at 2,000 ms for interactive calls.\n\nThe authors write: a retry without a backoff is a second outage waiting to happen, and it should be treated as one.",
	},
};

function ledger(): SourceLedger {
	const l = new SourceLedger();
	for (const [url, s] of Object.entries(SOURCES)) {
		l.recordSearch("searxng", "q", [{ title: s.title, url, snippet: "s" }]);
		l.recordExtract(url, { title: s.title, url, content: s.content, wordCount: s.content.split(/\s+/).length, provider: "tavily" });
	}
	return l;
}

const EXEMPLARS: Array<[file: string, depth: string]> = [["decision-retry-timeout.md", "deep"], ["comparison-job-queues.md", "deep"]];

describe("exemplar reports are the standard a new report is held to", () => {
	for (const [file, depth] of EXEMPLARS) {
		it(`${file} finalizes strict with no errors and no quality warnings, and its page looks right`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "pi-exemplar-"));
			try {
				const report = await readFile(join(import.meta.dirname, "..", "examples", "reports", file), "utf8");
				const result = await writeResearchPackage({ cwd: dir, slug: "ex", question: "q", depth, report, ledger: ledger(), archiveRoot: "docs/research", confidence: 70, styleDiagram: styleForPackage });
				assert.deepEqual(result.errors, []);
				const quality = result.warnings.filter((w) => /explains how|explanatory paragraph|labels ".*" with terms|derived|calc block/.test(w));
				assert.deepEqual(quality, []);
				const out = join(dir, "docs", "research", "ex");
				const html = await readFile(join(out, "report.html"), "utf8");
				assert.match(html, /<h2 id="how-it-works">/);
				assert.match(html, /<th>Calculation<\/th>/);
				assert.match(html, /sup class="derived"/);
				if (file.startsWith("decision")) {
					assert.match(html, /<figure class="diagram ix"/);
					assert.equal((html.match(/<svg class="dg"/g) ?? []).length, 2, "light and dark skins inline");
					assert.match(html, /<polygon points="[\d., ]+" fill="rgba\(191,69,32/, "the gate is drawn as the focal diamond");
				}
				assert.deepEqual(result.warnings.filter((w) => /drawn by Mermaid/.test(w)), []);
				assert.equal((html.match(/class="passage"/g) ?? []).length, file.startsWith("decision") ? 2 : 3);
				assert.ok((await readdir(out)).includes("research-package.json"));
				const chrome = findChrome();
				if (chrome) assert.deepEqual(await checkReportPage(chrome, html), []);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
});
