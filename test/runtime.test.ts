import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	JsonCache,
	ProviderBreaker,
	UnsafeUrlError,
	assertFetchableUrl,
	assertFetchableUrlResolved,
	fetchWithRetry,
	isPrivateAddress,
} from "../src/runtime.ts";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-research-"));
	dirs.push(dir);
	return dir;
}
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("JsonCache", () => {
	it("round-trips a value and expires it on the injected clock", async () => {
		let now = 1000;
		const cache = new JsonCache(await tempDir(), { now: () => now });
		await cache.set("k", { value: 1 }, 500);
		assert.deepEqual(await cache.get("k"), { value: 1 });
		now = 1501;
		assert.equal(await cache.get("k"), null);
	});
	it("is inert when disabled or when the TTL is zero", async () => {
		const cache = new JsonCache(await tempDir(), { enabled: false });
		await cache.set("k", 1, 1000);
		assert.equal(await cache.get("k"), null);
		const zero = new JsonCache(await tempDir());
		await zero.set("k", 1, 0);
		assert.equal(await zero.get("k"), null);
	});
});

function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(body, { status, headers });
}

describe("fetchWithRetry", () => {
	it("retries a 429 and honors Retry-After", async () => {
		const sleeps: number[] = [];
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return calls === 1 ? response("slow", 429, { "Retry-After": "1" }) : response("ok");
		}) as typeof fetch;
		const result = await fetchWithRetry("https://x", {}, {
			retries: 2,
			baseDelayMs: 10,
			fetchImpl,
			sleep: async (ms) => { sleeps.push(ms); },
		});
		assert.equal(result.status, 200);
		assert.equal(calls, 2);
		assert.deepEqual(sleeps, [1000]);
	});
	it("does not retry a 400", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return response("bad", 400);
		}) as typeof fetch;
		const result = await fetchWithRetry("https://x", {}, { retries: 3, baseDelayMs: 1, fetchImpl, sleep: async () => {} });
		assert.equal(result.status, 400);
		assert.equal(calls, 1);
	});
	it("stops at the retry limit and returns the last response", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return response("down", 503);
		}) as typeof fetch;
		const result = await fetchWithRetry("https://x", {}, { retries: 2, baseDelayMs: 1, fetchImpl, sleep: async () => {} });
		assert.equal(result.status, 503);
		assert.equal(calls, 3);
	});
	it("propagates an abort without retrying", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			throw new DOMException("Aborted", "AbortError");
		}) as typeof fetch;
		await assert.rejects(
			fetchWithRetry("https://x", {}, { retries: 3, baseDelayMs: 1, fetchImpl, sleep: async () => {} }),
			/Aborted/,
		);
		assert.equal(calls, 1);
	});
});

describe("ProviderBreaker", () => {
	it("opens after the threshold, closes after the cooldown, and resets on success", () => {
		let now = 0;
		const breaker = new ProviderBreaker({ failures: 2, cooldownMs: 100, now: () => now });
		breaker.recordFailure("a");
		assert.equal(breaker.isOpen("a"), false);
		breaker.recordFailure("a");
		assert.equal(breaker.isOpen("a"), true);
		now = 101;
		assert.equal(breaker.isOpen("a"), false);
		breaker.recordFailure("a");
		breaker.recordSuccess("a");
		assert.equal(breaker.isOpen("a"), false);
	});
});

describe("URL policy", () => {
	it("identifies private IPv4 and IPv6 ranges", () => {
		for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1"]) {
			assert.equal(isPrivateAddress(address), true, address);
		}
		for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
			assert.equal(isPrivateAddress(address), false, address);
		}
	});
	const policy = { allowPrivateHosts: false, allowedHosts: [], blockedHosts: [], allowedPorts: [80, 443] };
	it("allows a public https URL", () => {
		assert.equal(assertFetchableUrl("https://example.com/a", policy).hostname, "example.com");
	});
	it("refuses loopback, private IPs, credentials, odd schemes, and ports", () => {
		for (const url of ["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest", "https://user:pass@example.com/", "ftp://example.com/", "https://example.com:8080/"]) {
			assert.throws(() => assertFetchableUrl(url, policy), UnsafeUrlError, url);
		}
	});
	it("allows an explicitly allowed host and blocks a listed domain", () => {
		assert.doesNotThrow(() => assertFetchableUrl("http://localhost/", { ...policy, allowedHosts: ["localhost"] }));
		assert.throws(() => assertFetchableUrl("https://evil.example.com/", { ...policy, blockedHosts: ["example.com"] }), UnsafeUrlError);
	});
	it("refuses a public hostname that resolves to a private address", async () => {
		await assert.rejects(
			assertFetchableUrlResolved("https://public.example.com/", policy, async () => [{ address: "10.0.0.5" }]),
			/private address/,
		);
		await assert.doesNotReject(
			assertFetchableUrlResolved("https://public.example.com/", policy, async () => [{ address: "93.184.216.34" }]),
		);
	});
});
