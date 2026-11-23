import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceLedger } from "../src/ledger.ts";
import { lastAssistantText } from "../src/worker-session.ts";
import { MAX_WORKERS, parseWorkerAnswer, renderWorkerOutcomes, runWorkers } from "../src/workers.ts";

const ledger = () => {
	const l = new SourceLedger();
	l.recordSearch("t", "q", [{ title: "A", url: "https://a.example/x", snippet: "s" }, { title: "B", url: "https://b.example/y", snippet: "s" }]);
	l.recordExtract("https://a.example/x", { title: "A", url: "https://a.example/x", content: "text", wordCount: 1, provider: "t" });
	return l;
};

describe("parseWorkerAnswer", () => {
	const answer = [
		"- Revenue rose 12.5 percent in 2025 [source: https://a.example/x]",
		"- Invented claim [source: https://evil.example/z]",
		"- Uncited claim with no link",
		"- Snippet-only claim [source: https://b.example/y]",
		"Gap: no primary filing found",
		"stray prose",
	].join("\n");
	it("keeps ledger-backed claims, drops invented and uncited ones, and reads gaps", () => {
		const p = parseWorkerAnswer(answer, ledger());
		assert.deepEqual(p.findings.map((f) => f.text), ["Revenue rose 12.5 percent in 2025", "Snippet-only claim"]);
		assert.equal(p.dropped.length, 2);
		assert.deepEqual(p.gaps, ["no primary filing found"]);
	});
	it("accepts a claim line the model wrote without a bullet", () => {
		const p = parseWorkerAnswer("Revenue was 41.2 million. [source: https://a.example/x]\n\nGap: single source", ledger());
		assert.equal(p.findings[0].text, "Revenue was 41.2 million.");
		assert.deepEqual(p.gaps, ["single source"]);
	});
	it("marks whether the cited source was extracted or only seen in a search result", () => {
		const p = parseWorkerAnswer(answer, ledger());
		assert.deepEqual(p.findings.map((f) => f.extracted), [true, false]);
	});
	it("a claim citing one known and one unknown URL keeps only the known one", () => {
		const p = parseWorkerAnswer("- Mixed [source: https://a.example/x] [source: https://evil.example/z]", ledger());
		assert.deepEqual(p.findings[0].urls, ["https://a.example/x"]);
	});
});

describe("runWorkers", () => {
	it("respects the concurrency limit and keeps results in question order", async () => {
		let live = 0;
		let peak = 0;
		const outcomes = await runWorkers(["q1", "q2", "q3", "q4", "q5"], {
			concurrency: 2,
			timeoutMs: 5000,
			ledger: ledger(),
			run: async (q) => {
				live++;
				peak = Math.max(peak, live);
				await new Promise((r) => setTimeout(r, 20));
				live--;
				return `- ${q} fact [source: https://a.example/x]`;
			},
		});
		assert.equal(peak, 2);
		assert.deepEqual(outcomes.map((o) => o.parsed!.findings[0].text), ["q1 fact", "q2 fact", "q3 fact", "q4 fact", "q5 fact"]);
	});
	it("one worker failing or timing out does not lose the others", async () => {
		const outcomes = await runWorkers(["ok", "boom", "slow"], {
			concurrency: 3,
			timeoutMs: 50,
			ledger: ledger(),
			run: async (q, signal) => {
				if (q === "boom") throw new Error("model died");
				if (q === "slow") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
				return "- fine [source: https://a.example/x]";
			},
		});
		assert.deepEqual(outcomes.map((o) => o.ok), [true, false, false]);
		assert.match(outcomes[1].error!, /model died/);
		assert.match(outcomes[2].error!, /timed out after 50 ms/);
		assert.match(renderWorkerOutcomes(outcomes), /Worker failed: model died/);
	});
	it(`refuses more than ${MAX_WORKERS} workers`, async () => {
		await assert.rejects(runWorkers(Array.from({ length: MAX_WORKERS + 1 }, (_, i) => `q${i}`), { concurrency: 2, timeoutMs: 10, ledger: ledger(), run: async () => "" }), /at most 8/);
	});
	it("an aborted parent signal reaches the worker", async () => {
		const parent = new AbortController();
		const p = runWorkers(["q"], { concurrency: 1, timeoutMs: 5000, ledger: ledger(), signal: parent.signal, run: (_q, s) => new Promise((_, reject) => s.addEventListener("abort", () => reject(new Error("aborted")))) });
		setTimeout(() => parent.abort(), 10);
		assert.equal((await p)[0].ok, false);
	});
});

describe("lastAssistantText", () => {
	it("reads the final assistant text parts and ignores tool results", () => {
		assert.equal(lastAssistantText([{ role: "assistant", content: [{ type: "text", text: "old" }] }, { role: "toolResult", content: "x" }, { role: "assistant", content: [{ type: "toolCall" }, { type: "text", text: "final" }] }]), "final");
		assert.equal(lastAssistantText([]), "");
	});
});
