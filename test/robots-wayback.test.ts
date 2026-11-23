import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedByRules, parseRobots, RobotsChecker } from "../src/robots.ts";
import { findSnapshot, wayBackEligible } from "../src/wayback.ts";

const ok = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("robots", () => {
	const txt = "User-agent: *\nDisallow: /a/\nAllow: /a/ok\nDisallow: /*.pdf$\n\nUser-agent: PiDeepResearch\nDisallow: /only-us/\n";
	it("a named group beats the wildcard group", () => {
		const rules = parseRobots(txt);
		assert.equal(allowedByRules(rules, "/only-us/x"), false);
		assert.equal(allowedByRules(rules, "/a/x"), true, "the * group does not apply once a named group exists");
	});
	it("longest match wins, allow wins ties, wildcards and $ work", () => {
		const rules = parseRobots(txt, "other-bot");
		assert.equal(allowedByRules(rules, "/a/x"), false);
		assert.equal(allowedByRules(rules, "/a/ok"), true);
		assert.equal(allowedByRules(rules, "/f.pdf"), false);
		assert.equal(allowedByRules(rules, "/f.pdf?x=1"), true);
		assert.equal(allowedByRules(rules, "/b"), true);
	});
	it("an equal-length Allow and Disallow resolves to allowed", () => {
		assert.equal(allowedByRules(parseRobots("User-agent: *\nDisallow: /t\nAllow: /t\n"), "/t"), true);
	});
	it("an empty Disallow allows everything", () => {
		assert.equal(allowedByRules(parseRobots("User-agent: *\nDisallow:\n"), "/x"), true);
	});
	it("404 allows, 5xx denies, a network error allows", async () => {
		assert.equal((await new RobotsChecker(ok("", 404)).check("https://e.com/x")).allowed, true);
		assert.equal((await new RobotsChecker(ok("", 503)).check("https://e.com/x")).allowed, false);
		assert.equal((await new RobotsChecker((async () => { throw new Error("down"); }) as unknown as typeof fetch).check("https://e.com/x")).allowed, true);
	});
	it("fetches robots.txt once per origin", async () => {
		let n = 0;
		const checker = new RobotsChecker((async () => { n += 1; return new Response("User-agent: *\nDisallow: /x"); }) as unknown as typeof fetch);
		await checker.check("https://e.com/x");
		await checker.check("https://e.com/y");
		assert.equal(n, 1);
	});
});

describe("wayback", () => {
	const snap = (url: string, status = "200") => JSON.stringify({ archived_snapshots: { closest: { available: true, url, timestamp: "20240101120000", status } } });
	it("only 403, 404, 410 and 5xx are eligible; 401 and 402 never", () => {
		for (const s of [403, 404, 410, 500, 503]) assert.equal(wayBackEligible(s), true, String(s));
		for (const s of [200, 301, 401, 402, 429]) assert.equal(wayBackEligible(s), false, String(s));
	});
	it("returns the raw-page snapshot URL over https", async () => {
		const r = await findSnapshot("https://e.com/p", { fetchImpl: ok(snap("http://web.archive.org/web/20240101120000/https://e.com/p")) });
		assert.equal(r?.url, "https://web.archive.org/web/20240101120000id_/https://e.com/p");
		assert.equal(r?.timestamp, "20240101120000");
	});
	it("rejects a snapshot on another host, a non-2xx snapshot and a missing one", async () => {
		assert.equal(await findSnapshot("https://e.com/p", { fetchImpl: ok(snap("https://evil.example/web/20240101120000/x")) }), null);
		assert.equal(await findSnapshot("https://e.com/p", { fetchImpl: ok(snap("https://web.archive.org/web/20240101120000/x", "404")) }), null);
		assert.equal(await findSnapshot("https://e.com/p", { fetchImpl: ok("{}") }), null);
	});
});
