import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceLedger } from "../src/ledger.ts";

describe("ledger url statuses and citation return rate", () => {
	it("blocks payment_required and robots_blocked, not archived or duplicate", () => {
		const ledger = new SourceLedger();
		ledger.recordUrlStatus("https://a.example/x?utm_source=1", "payment_required", "HTTP 402");
		ledger.recordUrlStatus("https://b.example/", "robots_blocked");
		ledger.recordUrlStatus("https://c.example/", "archived");
		ledger.recordUrlStatus("https://d.example/", "duplicate");
		assert.match(ledger.blockedReason("https://a.example/x") ?? "", /payment_required: HTTP 402/);
		assert.equal(ledger.blockedReason("https://b.example/"), "robots_blocked");
		assert.equal(ledger.blockedReason("https://c.example/"), null);
		assert.equal(ledger.blockedReason("https://d.example/"), null);
		assert.deepEqual(ledger.stats().urlStatuses, { payment_required: 1, robots_blocked: 1, archived: 1, duplicate: 1 });
	});

	it("reports the share of cited URLs the tools returned", () => {
		const ledger = new SourceLedger();
		ledger.recordSearch("searxng", "q", [{ title: "T", url: "https://real.example/a", snippet: "s" }]);
		assert.equal(ledger.stats().citationReturnRate, null);
		const report = "See https://real.example/a and https://made.up/b and https://made.up/c and https://made.up/d.";
		assert.equal(ledger.stats(report).citationReturnRate, 0.25);
	});
});
