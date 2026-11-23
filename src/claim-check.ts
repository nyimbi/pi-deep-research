/**
 * Deterministic claim checks. For every cited sentence, each significant
 * number and each quoted passage must appear in a cited, archived source.
 * No model is involved, so this runs anywhere and cannot be argued with.
 *
 * Scope: numbers with a percent sign or decimal point, and integers of three
 * or more digits (years included). Small bare integers are ignored because
 * they are usually counts and ordinals. A sentence marked "(derived)" is
 * skipped, for arithmetic over cited figures; `(derived: name)` points at a
 * calc block, which recomputes the value (see calc.ts). A source that says "thirty"
 * where the report says "30" is a false positive; mark the sentence derived
 * or quote the source's own wording.
 */
import { extractUrls, normalizeUrl } from "./normalize.ts";

export interface ClaimIssue {
	kind: "number" | "quote";
	token: string;
	urls: string[];
	excerpt: string;
}

const NUMBER = /(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s?%)?/g;
const QUOTE = /"([^"\n]{12,})"|“([^”\n]{12,})”/g;

function fold(text: string): string {
	return text
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[*_`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function plainNumbers(text: string): string {
	return text.replace(/(\d),(?=\d{3}\b)/g, "$1");
}

function stripLinks(unit: string): string {
	return unit.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ");
}

function units(report: string): string[] {
	const out: string[] = [];
	let fenced = false;
	for (const line of report.split("\n")) {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced || /^\s*#{1,6}\s/.test(line) || !line.trim()) {
			if (/^\s*##\s+Sources\b/i.test(line)) break;
			continue;
		}
		if (/^\s*(?:[-*+]|\d+[.)])\s|^\s*\|/.test(line)) out.push(line);
		else out.push(...line.split(/(?<=[.!?])\s+(?=[A-Z"“[(])/));
	}
	return out;
}

export function checkClaims(report: string, sourceText: (url: string) => string | undefined): ClaimIssue[] {
	const issues: ClaimIssue[] = [];
	const haystacks = new Map<string, string>();
	const hay = (url: string): string | undefined => {
		const key = normalizeUrl(url);
		if (!haystacks.has(key)) {
			const text = sourceText(url);
			haystacks.set(key, text === undefined ? "" : fold(plainNumbers(text)));
		}
		return haystacks.get(key) || undefined;
	};
	for (const unit of units(report)) {
		if (/\(derived(?::[^)]*)?\)/i.test(unit)) continue;
		const urls = [...new Set(extractUrls(unit))];
		const texts = urls.map(hay).filter((value): value is string => Boolean(value));
		if (!texts.length) continue;
		const claim = stripLinks(unit).replace(/^\s*(?:\d+[.)]|[-*+])\s+/, "");
		const excerpt = claim.replace(/\s+/g, " ").trim().slice(0, 140);
		const found = (needle: string, pattern?: RegExp) =>
			texts.some((text) => (pattern ? pattern.test(text) : text.includes(needle)));
		for (const match of claim.matchAll(QUOTE)) {
			const quote = fold(match[1] ?? match[2]);
			if (quote.split(" ").length >= 3 && !found(quote)) issues.push({ kind: "quote", token: match[1] ?? match[2], urls, excerpt });
		}
		for (const match of plainNumbers(claim).matchAll(NUMBER)) {
			const [raw, whole, fraction, percent] = match;
			const significant = Boolean(percent) || fraction !== undefined || whole.length >= 3;
			if (!significant) continue;
			const token = fraction !== undefined ? `${whole}.${fraction}` : whole;
			const escaped = token.replace(".", "\\.");
			if (!found(token, new RegExp(`(?<![\\d.])${escaped}(?![\\d]|\\.\\d)`))) {
				issues.push({ kind: "number", token: `${token}${percent ? "%" : ""}`, urls, excerpt });
			}
			void raw;
		}
	}
	return issues;
}

/** Format issues as finalize messages: at most `limit` lines plus a count of the rest. */
export function describeClaimIssues(issues: ClaimIssue[], limit = 8): string[] {
	const lines = issues.slice(0, limit).map(
		(issue) => `claim check: ${issue.kind} "${issue.token}" is not in the cited source(s) ${issue.urls.join(", ")}; in: "${issue.excerpt}"`,
	);
	if (issues.length > limit) lines.push(`claim check: ${issues.length - limit} more unverified number or quote claims`);
	return lines;
}
