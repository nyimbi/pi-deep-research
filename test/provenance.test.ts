import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceLedger } from "../src/ledger.ts";
import { UrlProvenance } from "../src/provenance.ts";

const opts = { maxPageLinkFetches: 2 };
function ledgerWith(url: string): SourceLedger {
	const ledger = new SourceLedger();
	ledger.recordSearch("searxng", "q", [{ title: "T", url, snippet: "s" }]);
	return ledger;
}

describe("UrlProvenance", () => {
	it("allows user-typed and ledger URLs, refuses unknown ones", () => {
		const p = new UrlProvenance();
		p.noteUserText("please read https://user.example/a");
		const ledger = ledgerWith("https://found.example/b");
		assert.deepEqual(p.check("https://user.example/a", ledger, opts), { ok: true, via: "user" });
		assert.deepEqual(p.check("https://found.example/b", ledger, opts), { ok: true, via: "ledger" });
		assert.equal(p.check("https://evil.example/", ledger, opts).ok, false);
	});

	it("matches the whole URL, so a model cannot append a query string", () => {
		const p = new UrlProvenance();
		const ledger = ledgerWith("https://found.example/b");
		assert.equal(p.check("https://found.example/b?q=secret", ledger, opts).ok, false);
		assert.equal(p.check("https://found.example/b?utm_source=x#frag", ledger, opts).ok, true);
	});

	it("caps page-link fetches per turn and resets on a new turn", () => {
		const p = new UrlProvenance();
		const ledger = new SourceLedger();
		p.notePageText("see https://l.example/1 https://l.example/2 https://l.example/3");
		assert.equal(p.check("https://l.example/1", ledger, opts).ok, true);
		assert.equal(p.check("https://l.example/2", ledger, opts).ok, true);
		assert.equal(p.check("https://l.example/3", ledger, opts).ok, false);
		p.newTurn();
		assert.equal(p.check("https://l.example/3", ledger, opts).ok, true);
	});

	it("honours the explicit escape hatch", () => {
		const p = new UrlProvenance();
		assert.equal(p.check("https://any.example/", new SourceLedger(), { ...opts, allowUnlisted: true }).ok, true);
	});
});
