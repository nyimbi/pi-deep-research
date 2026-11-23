import assert from "node:assert/strict";
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

- None.

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
