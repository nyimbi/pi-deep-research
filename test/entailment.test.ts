import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkEntailment, judgeClaim } from "../src/entailment.ts";
import { SourceLedger } from "../src/ledger.ts";
import type { LlmClient } from "../src/llm.ts";
import { writeResearchPackage } from "../src/research-package.ts";

const url = "https://example.com/spec";
const text = "The connector times out after 30 seconds. Retries use exponential backoff.\n\nUnrelated paragraph about weather.";

/** A judge that says supported only when the passages contain every digit string of the claim. */
const fakeLlm = (fail = false): LlmClient => ({
	model: "fake",
	stats: () => ({ calls: 0, failures: 0 }),
	async json(_p, _s, user) {
		if (fail) throw new Error("down");
		const claim = /Claim: (.*)/.exec(user)![1];
		const nums = claim.match(/\d+/g) ?? [];
		return { supported: nums.every((n) => user.split("[passage")[1].includes(n)), rationale: "r" } as never;
	},
});

const ledger = () => {
	const l = new SourceLedger();
	l.recordSearch("searxng", "q", [{ title: "S", url, snippet: "s" }]);
	l.recordExtract(url, { title: "S", url, content: text, wordCount: 20, provider: "tavily" });
	return l;
};
const report = (finding: string) => `# T\n\n## Question\n\nq\n\n## Findings\n\n- ${finding} ([s](${url}))\n\n## Decisions\n\n- d\n\n## Rejected options\n\n- r\n\n## Confidence\n\n- c\n\n## Gaps\n\n- Only one source.\n\n## Scope\n\n- In scope: a\n- Out of scope: b\n\n## Contradictions\n\n- None found after checking 1 source.\n\n## Sources\n\nSee [s](${url}).\n`;

describe("entailment", () => {
	it("a model failure is an error verdict, never a pass", async () => {
		assert.equal(await judgeClaim(fakeLlm(true), "c", ["p"]), "error");
	});

	it("judges each cited finding against retrieved passages and reports the supported share", async () => {
		const r = await checkEntailment(`## Findings\n\n- It times out after 30 seconds ([s](${url}))\n- It times out after 60 seconds ([s](${url}))\n\n## Gaps\n`, ledger(), fakeLlm());
		assert.deepEqual(r.findings.map((f) => f.verdict), ["supported", "unsupported"]);
		assert.equal(r.supportedShare, 0.5);
	});

	it("finalize warns on an unsupported claim, records the result, and survives a model outage", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-ent-"));
		try {
			const base = { cwd, slug: "entail-check-run", question: "q", depth: "standard", ledger: ledger(), archiveRoot: "docs/research" };
			const bad = await writeResearchPackage({ ...base, report: report("It times out after 60 seconds."), entailment: (r) => checkEntailment(r, base.ledger, fakeLlm()) });
			assert.ok(bad.warnings.some((w) => w.startsWith("entailment: the cited passages do not appear to support")));
			assert.equal(bad.errors.filter((e) => e.startsWith("entailment")).length, 0);
			const saved = JSON.parse(await readFile(join(bad.packagePath, "research-package.json"), "utf8"));
			assert.equal(saved.entailment.findings[0].verdict, "unsupported");
			const down = await writeResearchPackage({ ...base, report: report("It times out after 30 seconds."), entailment: (r) => checkEntailment(r, base.ledger, fakeLlm(true)) });
			assert.ok(down.warnings.some((w) => /could not be judged/.test(w)));
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
