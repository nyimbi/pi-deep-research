import assert from "node:assert/strict";
import { styleForPackage } from "../src/diagram-style.ts";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SourceLedger } from "../src/ledger.ts";
import { RawStore } from "../src/raw-store.ts";
import { ensureSections, resolveArchiveRoot, writeResearchPackage } from "../src/research-package.ts";

const dirs: string[] = [];
async function cwd(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-package-"));
	dirs.push(dir);
	return dir;
}
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const REPORT = `# Timeout policy

## Question

What timeout should the connector use?

## Findings

- Thirty seconds with two retries fits the observed tail.

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

See [the specification](https://example.com/spec).
`;

function ledgerWith(url = "https://example.com/spec"): SourceLedger {
	const ledger = new SourceLedger();
	ledger.recordSearch("searxng", "connector timeout", [{ title: "Specification", url, snippet: "timeout 30" }]);
	ledger.recordExtract(url, {
		title: "Specification",
		url,
		content: "The connector should time out after thirty seconds.",
		wordCount: 8,
		provider: "tavily",
	});
	return ledger;
}

describe("writeResearchPackage", () => {
	it("writes README, an archived source, a hashed index, and metadata", async () => {
		const root = await cwd();
		const result = await writeResearchPackage({
			cwd: root,
			slug: "connector-timeout",
			question: "What timeout should the connector use?",
			depth: "standard",
			report: REPORT,
			confidence: 90,
			ledger: ledgerWith(),
			archiveRoot: "docs/research",
		});
		assert.deepEqual(result.errors, []);
		assert.equal(result.archived, 1);
		const packagePath = join(root, "docs", "research", "connector-timeout");
		const readme = await readFile(join(packagePath, "README.md"), "utf8");
		assert.match(readme, /## Rejected options/);
		const index = await readFile(join(packagePath, "sources", "INDEX.md"), "utf8");
		assert.match(index, /https:\/\/example\.com\/spec/);
		const files = await readdir(join(packagePath, "sources"));
		assert.equal(files.filter((file) => file !== "INDEX.md").length, 1);
		assert.ok((await readdir(packagePath)).includes("research-package.json"));
		assert.ok((await readdir(packagePath)).includes("ledger.json"));
		const page = await readFile(join(packagePath, "report.html"), "utf8");
		assert.match(page, /<h1>Timeout policy<\/h1>/);
		assert.match(page, /id="colophon"/);
		const metadata = JSON.parse(await readFile(join(packagePath, "research-package.json"), "utf8"));
		assert.equal(metadata.archive_root, "docs/research");
		assert.equal(metadata.confidence, 90);
	});

	it("archives the raw page beside the extracted text", async () => {
		const root = await cwd();
		const ledger = ledgerWith();
		const store = new RawStore(join(root, "raw"));
		const raw = await store.capture("https://example.com/spec", {
			fetchImpl: (async () => new Response("<html>spec page</html>", { headers: { "Content-Type": "text/html" } })) as typeof fetch,
		});
		ledger.attachRaw("https://example.com/spec", raw);
		const result = await writeResearchPackage({
			cwd: root,
			slug: "raw-page",
			question: "What timeout?",
			depth: "standard",
			report: REPORT,
			ledger,
			archiveRoot: "docs/research",
		});
		assert.deepEqual(result.errors, []);
		assert.equal(result.pages, 1);
		const files = await readdir(join(root, "docs", "research", "raw-page", "sources"));
		assert.ok(files.some((file) => file.endsWith(".html")));
		assert.ok(files.some((file) => file.endsWith(".md")));
		const index = await readFile(join(root, "docs", "research", "raw-page", "sources", "INDEX.md"), "utf8");
		assert.match(index, /Page copy/);
	});

	it("fails when the report cites a URL the tools never returned", async () => {
		const root = await cwd();
		const report = REPORT.replace("https://example.com/spec", "https://invented.example/spec");
		const result = await writeResearchPackage({
			cwd: root,
			slug: "invented",
			question: "What timeout?",
			depth: "standard",
			report,
			ledger: ledgerWith(),
			archiveRoot: "docs/research",
		});
		assert.ok(result.errors.some((error) => /never returned/.test(error)));
	});

	it("fails a diagram whose figure the named source does not contain, and warns instead when strict is off", async () => {
		const root = await cwd();
		const diagram = "\n\n```mermaid\nflowchart LR\n  %% source: https://example.com/spec\n  A[Timeout] -->|99.5%| B[Reply]\n```\n";
		const run = (strict: boolean) =>
			writeResearchPackage({ cwd: root, slug: strict ? "dg-strict" : "dg-loose", question: "What timeout?", depth: "standard", report: REPORT + diagram, ledger: ledgerWith(), archiveRoot: "docs/research", strict });
		assert.ok((await run(true)).errors.some((e) => /diagram 1: .*99\.5%/.test(e)));
		const loose = await run(false);
		assert.ok(!loose.errors.some((e) => /diagram 1/.test(e)));
		assert.ok(loose.warnings.some((w) => /diagram 1/.test(w)));
	});

	it("renders diagrams: a render error fails a strict run, and a good render ships .mmd and .svg", async () => {
		const root = await cwd();
		const block = "\n\n```mermaid\nflowchart LR\n  A[Timeout] --> B[Reply]\n```\n";
		const run = (slug: string, renderDiagram: any, strict = true) =>
			writeResearchPackage({ cwd: root, slug, question: "What timeout?", depth: "standard", report: REPORT.replace("observed tail.", "observed tail ([spec](https://example.com/spec)).") + block, ledger: ledgerWith(), archiveRoot: "docs/research", strict, renderDiagram });
		const bad = await run("rd-bad", async () => ({ error: "Parse error on line 2" }));
		assert.ok(bad.errors.some((e) => /diagram 1 does not render: Parse error/.test(e)));
		assert.ok((await run("rd-warn", async () => ({ error: "x" }), false)).warnings.some((w) => /does not render/.test(w)));
		const absent = await run("rd-absent", async () => ({ error: "mmdc is not installed", unavailable: true }));
		assert.ok(!absent.errors.some((e) => /render/.test(e)), "a missing renderer must not fail finalize");
		assert.ok(absent.warnings.some((w) => /mmdc is not installed/.test(w)));
		const good = await run("rd-good", async () => ({ svg: "<svg id=\"ok\"/>" }));
		assert.ok(!good.errors.some((e) => /render/.test(e)));
		const { readFile } = await import("node:fs/promises");
		const dir = join(root, "docs/research/rd-good/diagrams");
		assert.equal(await readFile(join(dir, "diagram-1.svg"), "utf8"), "<svg id=\"ok\"/>");
		assert.match(await readFile(join(good.packagePath, "README.rendered.md"), "utf8"), /!\[Diagram 1\]\(diagrams\/diagram-1\.svg\)/);
		assert.match(await readFile(join(dir, "diagram-1.mmd"), "utf8"), /flowchart LR/);
		assert.match(await readFile(join(dir, "evidence-graph.mmd"), "utf8"), /example\.com/);
		assert.equal(await readFile(join(dir, "evidence-graph.svg"), "utf8"), "<svg id=\"ok\"/>");
	});

	it("draws a simple flowchart in the editorial style, and says why when it cannot", async () => {
		const root = await cwd();
		const simple = "\n\nThe reply follows the timeout in this path.\n\n```mermaid\nflowchart LR\n  A[Timeout] -->|then| B[Reply]\n```\n";
		const hard = "\n\nThe reply follows the timeout in this path.\n\n```mermaid\nerDiagram\n  A ||--o{ B : has\n```\n";
		const run = (slug: string, tail: string, gates?: (p: string) => Promise<string[]>) =>
			writeResearchPackage({ cwd: root, slug, question: "What timeout?", depth: "standard", report: REPORT.replace("observed tail.", "observed tail ([spec](https://example.com/spec)).") + tail, ledger: ledgerWith(), archiveRoot: "docs/research", renderDiagram: async () => ({ svg: "<svg id=\"mmdc\"/>" }), styleDiagram: styleForPackage, designGates: gates });
		const { readFile } = await import("node:fs/promises");
		const ok = await run("ed-ok", simple, async (page) => [`gate saw ${page.split("/").pop()}`]);
		const svg = await readFile(join(root, "docs/research/ed-ok/diagrams/diagram-1.svg"), "utf8");
		assert.match(svg, /aria-labelledby="diagram-1-title/);
		assert.ok(!svg.includes("mmdc"), "the editorial drawing replaces Mermaid's");
		assert.match(await readFile(join(root, "docs/research/ed-ok/diagrams/diagram-1.html"), "utf8"), /Diagram Design/);
		assert.ok(ok.warnings.includes("gate saw diagram-1.html"), "the skill's gates run on the written page");
		assert.ok(ok.warnings.includes("gate saw diagram-1.dark.html"), "and on the dark page");
		const dark = await readFile(join(root, "docs/research/ed-ok/diagrams/diagram-1.dark.svg"), "utf8");
		assert.match(dark, /fill="#2d3142"/);
		assert.match(await readFile(join(root, "docs/research/ed-ok/diagrams/diagram-1.dark.html"), "utf8"), /background: #2d3142/);
		assert.match(await readFile(join(root, "docs/research/ed-ok/README.rendered.md"), "utf8"), /<source media="\(prefers-color-scheme: dark\)" srcset="diagrams\/diagram-1\.dark\.svg">/);
		const fallback = await run("ed-hard", hard);
		assert.match(await readFile(join(root, "docs/research/ed-hard/diagrams/diagram-1.svg"), "utf8"), /id="mmdc"/);
		assert.ok(fallback.warnings.some((w) => /diagram 1 is drawn by Mermaid, not in the editorial style: not a diagram/.test(w)));
		await assert.rejects(readFile(join(root, "docs/research/ed-hard/diagrams/diagram-1.html"), "utf8"));
	});

	it("fails a cited source that was never extracted, unless strict is off", async () => {
		const root = await cwd();
		const ledger = new SourceLedger();
		ledger.recordSearch("searxng", "q", [{ title: "Spec", url: "https://example.com/spec", snippet: "s" }]);
		const base = { cwd: root, slug: "not-extracted", question: "Q", depth: "standard", report: REPORT, ledger, archiveRoot: "docs/research" };
		const strict = await writeResearchPackage(base);
		assert.ok(strict.errors.some((error) => /never extracted/.test(error)));
		const relaxed = await writeResearchPackage({ ...base, slug: "not-extracted-soft", strict: false });
		assert.ok(relaxed.warnings.some((warning) => /never extracted/.test(warning)));
	});

	it("adds missing report sections and says so", () => {
		const result = ensureSections("# Title\n\nBody", { question: "Q", decisions: ["d"], gaps: ["g"] });
		assert.match(result.report, /## Question/);
		assert.match(result.report, /## Rejected options/);
		assert.ok(result.warnings.length > 0);
	});

	it("resolves a relative archive root at the git repository root from a subdirectory", async () => {
		const root = await cwd();
		await mkdir(join(root, ".git"));
		const nested = join(root, "app", "server");
		await mkdir(nested, { recursive: true });
		const result = await writeResearchPackage({
			cwd: nested,
			slug: "repo-rooted",
			question: "Where does the package go?",
			depth: "quick",
			report: REPORT,
			ledger: ledgerWith(),
			archiveRoot: "docs/research",
		});
		assert.equal(result.packagePath, join(root, "docs", "research", "repo-rooted"));
		assert.equal(resolveArchiveRoot(nested, "docs/research"), join(root, "docs", "research"));
	});

	it("keeps an absolute archive root and falls back to cwd outside a repository", async () => {
		const root = await cwd();
		assert.equal(resolveArchiveRoot(root, "/tmp/absolute-research"), "/tmp/absolute-research");
		assert.equal(resolveArchiveRoot(root, "docs/research"), join(root, "docs", "research"));
	});

	it("refuses an invalid slug", async () => {
		await assert.rejects(
			writeResearchPackage({
				cwd: await cwd(),
				slug: "../escape",
				question: "Q",
				depth: "standard",
				report: REPORT,
				ledger: ledgerWith(),
				archiveRoot: "docs/research",
			}),
			/invalid research slug/,
		);
	});
});

import { checkHonestySections } from "../src/research-package.ts";

describe("checkHonestySections", () => {
	const base = (gaps: string, scope: string, contradictions: string) =>
		`## Gaps\n\n${gaps}\n\n## Scope\n\n${scope}\n\n## Contradictions\n\n${contradictions}\n\n## Sources\n`;
	const SCOPE = "- In scope: a\n- Out of scope: b";
	const ok = "- Source A says 5, source B says 6 ([a](https://a.example/x), [b](https://b.example/y)).";

	it("accepts a substantive report", () => {
		assert.deepEqual(checkHonestySections(base("- One source.", SCOPE, ok)), []);
		assert.deepEqual(checkHonestySections(base("- One source.", SCOPE, "None found after checking 4 sources.")), []);
	});

	it("rejects empty or token answers", () => {
		for (const gaps of ["- None.", "- N/A", "None recorded.", "- none"]) {
			assert.match(checkHonestySections(base(gaps, SCOPE, ok)).join(), /## Gaps/);
		}
	});

	it("requires both halves of Scope", () => {
		assert.match(checkHonestySections(base("- g", "- In scope: a", ok)).join(), /## Scope/);
	});

	it("requires two distinct sources per contradiction, and a real entry", () => {
		assert.match(checkHonestySections(base("- g", SCOPE, "- A conflicts with B ([a](https://a.example/x)).")).join(), /fewer than two/);
		assert.match(checkHonestySections(base("- g", SCOPE, "- A conflicts ([a](https://a.example/x) [a2](https://a.example/x#f)).")).join(), /fewer than two/);
		assert.match(checkHonestySections(base("- g", SCOPE, "")).join(), /## Contradictions must list/);
	});
});

describe("report.html and report.pdf", () => {
	it("writes the page, hands it to the page check, and prints the pdf from the same file", async () => {
		const root = await cwd();
		const seen: string[] = [];
		const result = await writeResearchPackage({
			cwd: root,
			slug: "page",
			question: "q",
			depth: "standard",
			report: REPORT,
			ledger: ledgerWith(),
			archiveRoot: "docs/research",
			pageChecks: {
				check: async (html) => {
					seen.push(html);
					return ["report.html overflows sideways at 390px (page is 900px wide)"];
				},
				pdf: async (htmlPath, pdfPath) => {
					seen.push(htmlPath, pdfPath);
					return "report.pdf was not written (stub)";
				},
			},
		});
		assert.match(seen[0]!, /<h1>Timeout policy<\/h1>/);
		assert.ok(seen[1]!.endsWith("/page/report.html") && seen[2]!.endsWith("/page/report.pdf"));
		assert.ok(result.warnings.includes("report.html overflows sideways at 390px (page is 900px wide)"));
		assert.ok(result.warnings.includes("report.pdf was not written (stub)"));
		assert.deepEqual(result.errors, []);
	});
	it("writes nothing when html is off", async () => {
		const root = await cwd();
		await writeResearchPackage({ cwd: root, slug: "off", question: "q", depth: "standard", report: REPORT, ledger: ledgerWith(), archiveRoot: "docs/research", html: false });
		assert.ok(!(await readdir(join(root, "docs", "research", "off"))).includes("report.html"));
	});
});

describe("publication warnings in finalize", () => {
	it("warns a deep report with no mechanism section and a diagram label the prose never uses, but not a standard one", async () => {
		const root = await cwd();
		const withDiagram = `${REPORT}\n## Diagrams\n\nThe valve admits or parks each request.\n\n\`\`\`mermaid\nflowchart LR\n  A[Zebra latch] --> B[Quartz store]\n\`\`\`\n`;
		const base = { cwd: root, slug: "pub", question: "q", ledger: ledgerWith(), archiveRoot: "docs/research", strict: false };
		const deep = await writeResearchPackage({ ...base, depth: "deep", report: withDiagram });
		assert.ok(deep.warnings.some((w) => /no section explains how the subject works/.test(w)));
		assert.ok(deep.warnings.some((w) => /diagram 1 labels "Zebra latch", "Quartz store"/.test(w)));
		const standard = await writeResearchPackage({ ...base, slug: "pub2", depth: "standard", report: withDiagram });
		assert.ok(!standard.warnings.some((w) => /no section explains/.test(w)));
		assert.ok(standard.warnings.some((w) => /diagram 1 labels/.test(w)));
	});
});
