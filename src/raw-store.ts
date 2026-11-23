/**
 * Capture the raw page or document for a URL at extraction time.
 *
 * Providers return readable text; the text is not the artefact. This store
 * fetches the original body (subject to the same URL policy as extraction),
 * writes it under the cache directory, and hands the ledger enough metadata to
 * copy it into the research package later.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertFetchableUrlResolved, type UrlPolicy } from "./runtime.ts";

export interface RawCapture {
	url: string;
	path: string;
	suffix: string;
	digest: string;
	bytes: number;
	contentType: string;
	capturedAt: string;
}

export interface CaptureOptions {
	fetchImpl?: typeof fetch;
	policy?: UrlPolicy;
	maxBytes?: number;
}

function suffixFor(contentType: string, url: string): string {
	const type = contentType.split(";")[0].trim().toLowerCase();
	const known: Record<string, string> = {
		"text/html": ".html",
		"application/xhtml+xml": ".html",
		"application/pdf": ".pdf",
		"application/json": ".json",
		"text/plain": ".txt",
		"text/markdown": ".md",
		"application/xml": ".xml",
		"text/xml": ".xml",
	};
	if (known[type]) return known[type];
	const path = url.split("?")[0];
	const match = path.match(/(\.[a-z0-9]{2,5})$/i);
	return match ? match[1].toLowerCase() : ".bin";
}

export class RawStore {
	private readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	async capture(url: string, options: CaptureOptions = {}): Promise<RawCapture> {
		if (options.policy) await assertFetchableUrlResolved(url, options.policy);
		const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
		const response = await (options.fetchImpl ?? globalThis.fetch)(url, {
			headers: { "User-Agent": "Mozilla/5.0 (compatible; PiDeepResearch/1.0)", Accept: "*/*" },
			redirect: "follow",
		});
		if (!response.ok) throw new Error(`page capture failed ${response.status} for ${url}`);
		const declared = Number(response.headers.get("content-length") ?? "0");
		if (declared > maxBytes) throw new Error(`page exceeds ${maxBytes} bytes for ${url}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) throw new Error(`page exceeds ${maxBytes} bytes for ${url}`);
		const digest = createHash("sha256").update(bytes).digest("hex");
		const contentType = response.headers.get("content-type") ?? "application/octet-stream";
		const suffix = suffixFor(contentType, url);
		await mkdir(this.dir, { recursive: true });
		const path = join(this.dir, `${digest}${suffix}`);
		await writeFile(path, bytes);
		return {
			url,
			path,
			suffix,
			digest,
			bytes: bytes.byteLength,
			contentType,
			capturedAt: new Date().toISOString(),
		};
	}

	async copyTo(capture: RawCapture, destination: string): Promise<void> {
		await copyFile(capture.path, destination);
	}
}
