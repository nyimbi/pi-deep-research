import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractHtml } from "../html-extract.ts";
import { assertFetchableUrlResolved, type UrlPolicy } from "../runtime.ts";
import type { BrowserSettings } from "../settings.ts";
import type { ExtractResult, SearchProvider, SearchRequest } from "../types.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/render.py", import.meta.url));

export interface RenderResult {
	html: string;
	title: string;
	finalUrl: string;
	blocked: string[];
}

export interface BrowserDeps {
	/** Decides every request the page makes. Defaults to the fetch-safety policy. */
	allow?: (url: string) => Promise<boolean>;
	policy: UrlPolicy;
}

/** Render a page and return its HTML. `allow` is asked about every request, subresources included. */
export function renderPage(url: string, settings: BrowserSettings, allow: (url: string) => Promise<boolean>, signal?: AbortSignal): Promise<RenderResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(settings.python, [SCRIPT, url, String(settings.timeoutMs)], { stdio: ["pipe", "pipe", "pipe"], signal });
		let buffer = "";
		let stderr = "";
		let result: RenderResult | null = null;
		let chain: Promise<void> = Promise.resolve();
		child.stderr.on("data", (d) => (stderr += d));
		child.stdout.on("data", (d) => {
			buffer += d;
			let at: number;
			while ((at = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				chain = chain.then(async () => {
					const msg = JSON.parse(line) as { id?: number; check?: string; result?: { html: string; title: string; final_url: string; blocked: string[] } };
					if (msg.result) result = { html: msg.result.html, title: msg.result.title, finalUrl: msg.result.final_url, blocked: msg.result.blocked };
					else if (msg.check !== undefined) child.stdin.write(JSON.stringify({ id: msg.id, ok: await allow(msg.check).catch(() => false) }) + "\n");
				});
			}
		});
		child.on("error", reject);
		child.on("close", (code) => {
			chain.then(() => (result ? resolve(result) : reject(new Error(`browser render failed (exit ${code}): ${stderr.trim().split("\n").slice(-2).join(" ")}`)))).catch(reject);
		});
	});
}

/**
 * JavaScript-rendered pages through a local headless Chromium. Off by default; it sits last among the
 * local providers, so it runs only when the plain extractors declined the page.
 */
export function createBrowserProvider(settings: BrowserSettings, deps: BrowserDeps): SearchProvider {
	const allow = deps.allow ?? (async (target: string) => {
		try {
			await assertFetchableUrlResolved(target, deps.policy);
			return true;
		} catch {
			return false;
		}
	});
	return {
		name: "browser",
		tier: "local",
		isConfigured: () => settings.enabled,
		search: async (_req: SearchRequest) => [],
		async extract(url: string, signal?: AbortSignal): Promise<ExtractResult> {
			const rendered = await renderPage(url, settings, allow, signal);
			const out = extractHtml(rendered.html, rendered.finalUrl || url);
			if (rendered.blocked.length) console.warn(`[pi-deep-research] browser blocked ${rendered.blocked.length} request(s) by URL policy`);
			return { title: out.title || rendered.title, url, content: out.markdown, author: out.author, publishedDate: out.publishedDate, wordCount: out.words, provider: "browser" };
		},
	};
}
