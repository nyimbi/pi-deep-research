import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SourceLedger } from "../src/ledger.ts";
import { addFinding, checkReportAgainstNotes, loadNotes, newNotes, saveNotes } from "../src/notes.ts";
import { writeResearchPackage } from "../src/research-package.ts";

const url = "https://example.com/spec";
const ledger = () => {
	const l = new SourceLedger();
	l.recordSearch("searxng", "q", [{ title: "S", url, snippet: "s" }]);
	l.recordExtract(url, { title: "S", url, content: "The connector times out after 30 seconds.", wordCount: 7, provider: "tavily" });
	return l;
};
const report = (finding: string) => `# T\n\n## Question\n\nq\n\n## Findings\n\n- ${finding}\n\n## Decisions\n\n- d\n\n## Rejected options\n\n- r\n\n## Confidence\n\n- c\n\n## Gaps\n\n- Only one source.\n\n## Scope\n\n- In scope: a\n- Out of scope: b\n\n## Contradictions\n\n- None found after checking 1 source.\n\n## Sources\n\nSee [s](${url}).\n`;

describe("notes", () => {
	it("refuses a finding on an unknown sub-question, with no source, or with a URL no tool returned", () => {
		const n = newNotes("n-run", "q", ["a?"]);
		const l = ledger();
		assert.throws(() => addFinding(n, l, "Q9", "t", [url]), /unknown sub-question/);
		assert.throws(() => addFinding(n, l, "Q1", "t", []), /at least one source/);
		assert.throws(() => addFinding(n, l, "Q1", "t", ["https://made.up/x"]), /never returned/);
		assert.equal(addFinding(n, l, "Q1", "It times out after 30 seconds.", [url]), "F1");
	});

	it("survives a context reset: notes and the ledger round-trip through disk", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-notes-"));
		try {
			const n = newNotes("n-run", "q", ["a?"], [{ text: "names a number" }]);
			const l = ledger();
			addFinding(n, l, "Q1", "30 seconds.", [url]);
			await saveNotes(dir, n, l);
			const back = await loadNotes(dir);
			assert.equal(back?.findings[0].id, "F1");
			const restored = SourceLedger.restore(JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, "ledger.json"), "utf8")));
			assert.equal(restored.source(url)?.extracted?.content, "The connector times out after 30 seconds.");
			assert.equal(restored.stats().sources, 1);
			assert.throws(() => SourceLedger.restore({ nope: 1 }), /not a ledger snapshot/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects a finding line with no evidence ID, an unknown ID, and an unsatisfied mandatory rubric item", () => {
		const n = newNotes("n-run", "q", ["a?", "b?"], [{ text: "m" }, { text: "o", tier: "optional" }]);
		addFinding(n, ledger(), "Q1", "t", [url]);
		const r = checkReportAgainstNotes(report("It times out [F1] and [F7]\n- Orphan line"), n, "standard");
		assert.ok(r.errors.some((e) => e.startsWith("evidence ID [F7]")));
		assert.ok(r.errors.some((e) => e.startsWith("finding has no evidence ID")));
		assert.ok(r.errors.some((e) => e.startsWith("rubric item R1 (mandatory)")));
		assert.ok(r.warnings.some((w) => w.startsWith("rubric item R2 (optional)")));
		assert.ok(r.warnings.some((w) => w.startsWith("sub-question Q2 has no findings")));
		assert.ok(r.warnings.some((w) => w.startsWith("no critic revision")));
	});

	it("finalize enforces the notes, and passes once ids, rubric and a revision are in place", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-notes-fin-"));
		try {
			const l = ledger();
			const n = newNotes("notes-run-a", "q", ["a?"], [{ text: "names a number" }]);
			addFinding(n, l, "Q1", "It times out after 30 seconds.", [url]);
			await saveNotes(join(cwd, "docs/research/notes-run-a"), n, l);
			const base = { cwd, slug: "notes-run-a", question: "q", depth: "standard", ledger: l, archiveRoot: "docs/research" };
			const bad = await writeResearchPackage({ ...base, report: report(`It times out after 30 seconds ([s](${url}))`) });
			assert.ok(bad.errors.some((e) => e.startsWith("finding has no evidence ID")));
			assert.ok(bad.errors.some((e) => e.startsWith("rubric item R1")));
			n.rubric[0].satisfied = true;
			n.revisions = 1;
			await saveNotes(join(cwd, "docs/research/notes-run-a"), n, l);
			const good = await writeResearchPackage({ ...base, report: report(`It times out after 30 seconds [F1] ([s](${url}))`) });
			assert.deepEqual(good.errors, []);
			assert.ok(!good.warnings.some((w) => w.startsWith("no critic revision")));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
