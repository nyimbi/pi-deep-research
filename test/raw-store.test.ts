import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { RawStore } from "../src/raw-store.ts";
import { UnsafeUrlError } from "../src/runtime.ts";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-raw-"));
	dirs.push(dir);
	return dir;
}
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const policy = { allowPrivateHosts: false, allowedHosts: [], blockedHosts: [], allowedPorts: [80, 443] };

describe("RawStore", () => {
	it("saves the raw HTML with its digest", async () => {
		const store = new RawStore(await tempDir());
		const capture = await store.capture("https://example.com/page", {
			policy,
			fetchImpl: (async () => new Response("<html>page</html>", { headers: { "Content-Type": "text/html" } })) as typeof fetch,
		});
		assert.equal(capture.suffix, ".html");
		assert.equal(capture.bytes, 17);
		assert.equal((await stat(capture.path)).size, 17);
		assert.equal(await readFile(capture.path, "utf8"), "<html>page</html>");
	});
	it("keeps a PDF as a PDF", async () => {
		const store = new RawStore(await tempDir());
		const capture = await store.capture("https://example.com/paper", {
			policy,
			fetchImpl: (async () => new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } })) as typeof fetch,
		});
		assert.equal(capture.suffix, ".pdf");
	});
	it("refuses a body over the size cap", async () => {
		const store = new RawStore(await tempDir());
		await assert.rejects(
			store.capture("https://example.com/big", {
				policy,
				maxBytes: 4,
				fetchImpl: (async () => new Response("12345")) as typeof fetch,
			}),
			/exceeds/,
		);
	});
	it("refuses a private URL before fetching", async () => {
		const store = new RawStore(await tempDir());
		await assert.rejects(
			store.capture("http://127.0.0.1/secret", { policy }),
			UnsafeUrlError,
		);
	});
});
