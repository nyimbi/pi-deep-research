import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createClinicalTrialsProvider, createCourtListenerProvider, createEdgarProvider, createGdeltProvider, createGithubCodeProvider, createPubmedProvider } from "../src/native/domain.ts";

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/domain/${name}`, import.meta.url), "utf8"));
const seen: Array<{ url: string; headers: Record<string, string> }> = [];
const serve = (...bodies: unknown[]) => {
	let i = 0;
	return (async (url: string, init?: RequestInit) => {
		seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
		const body = bodies[Math.min(i++, bodies.length - 1)];
		return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
	}) as unknown as typeof fetch;
};
const req = { query: "q", maxResults: 5 };
afterEach(() => {
	seen.length = 0;
	for (const k of ["SEC_USER_AGENT", "COURTLISTENER_TOKEN", "GITHUB_TOKEN"]) delete process.env[k];
});

describe("domain adapters, shapes captured live", () => {
	it("EDGAR needs a declared User-Agent, then returns a filing URL and typed record", async () => {
		const p = createEdgarProvider(serve(fx("edgar.live.json")));
		assert.equal(p.isConfigured(), false);
		process.env.SEC_USER_AGENT = "Example Research test@example.com";
		assert.equal(p.isConfigured(), true);
		const [first] = await p.search(req);
		assert.equal(seen[0].headers["User-Agent"], "Example Research test@example.com");
		assert.match(first.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/.+/);
		assert.equal(first.record?.kind, "sec-filing");
		assert.match(first.record!.id, /^\d{10}-\d{2}-\d{6}$/);
		assert.match(first.record!.date!, /^\d{4}-\d{2}-\d{2}$/);
	});
	it("ClinicalTrials.gov returns the NCT id, status and last-update date", async () => {
		const [first] = await createClinicalTrialsProvider(serve(fx("clinicaltrials.live.json"))).search(req);
		assert.match(first.record!.id, /^NCT\d{8}$/);
		assert.equal(first.url, `https://clinicaltrials.gov/study/${first.record!.id}`);
		assert.ok(first.record!.status);
		assert.match(first.record!.date!, /^\d{4}-\d{2}/);
	});
	it("PubMed joins esearch ids to esummary titles and dates", async () => {
		const f = fx("pubmed.live.json");
		const out = await createPubmedProvider(serve(f.search, f.summary)).search(req);
		assert.equal(out.length, f.search.esearchresult.idlist.length);
		assert.equal(out[0].url, `https://pubmed.ncbi.nlm.nih.gov/${out[0].record!.id}/`);
		assert.match(out[0].publishedDate!, /^\d{4}-\d{2}-\d{2}$/);
		for (const row of out) assert.equal(row.title, f.summary.result[row.record!.id].title.replace(/\.$/, ""), `row ${row.record!.id} carries another record's title`);
		assert.equal(new Set(out.map((r) => r.title)).size, out.length);
		assert.equal(seen.length, 2);
	});
});

describe("domain adapters, documented shapes only (not live-verified here)", () => {
	it("GDELT parses seendate and treats a plain-text 200 as a rate limit", async () => {
		const [a] = await createGdeltProvider(serve(fx("gdelt.documented.json"))).search(req);
		assert.equal(a.publishedDate, "2026-03-01");
		assert.equal(a.record?.kind, "news-article");
		await assert.rejects(createGdeltProvider(serve("Please limit requests to one every 5 seconds")).search(req), /rate limited/);
	});
	it("CourtListener and GitHub stay off without their token and send it when set", async () => {
		const court = createCourtListenerProvider(serve(fx("courtlistener.documented.json")));
		const gh = createGithubCodeProvider(serve(fx("github.documented.json")));
		assert.equal(court.isConfigured(), false);
		assert.equal(gh.isConfigured(), false);
		process.env.COURTLISTENER_TOKEN = "ct";
		process.env.GITHUB_TOKEN = "gt";
		const [o] = await court.search(req);
		const [c] = await gh.search(req);
		assert.equal(o.url, "https://www.courtlistener.com/opinion/1/doe-v-roe/");
		assert.equal(o.record?.status, "Published");
		assert.equal(c.url, "https://github.com/o/r/blob/main/src/x.ts");
		assert.equal(seen[0].headers.Authorization, "Token ct");
		assert.equal(seen[1].headers.Authorization, "Bearer gt");
	});
	it("an HTTP error names the service", async () => {
		const bad = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
		await assert.rejects(createClinicalTrialsProvider(bad).search(req), /ClinicalTrials\.gov API error 403/);
	});
});
