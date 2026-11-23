/**
 * Per-finding evidence grade computed from the ledger, in the spirit of GRADE and
 * the Admiralty scale: source tier plus corroboration by independent domains.
 * Overall confidence is the minimum over findings, so one weak claim caps the report.
 * Publication date is not graded: the ledger does not keep it yet.
 */
import type { SourceLedger } from "./ledger.ts";
import { classifyTier, extractUrls, normalizeUrl } from "./normalize.ts";
import { sectionBody } from "./research-package.ts";

export type Grade = "high" | "moderate" | "low" | "very-low";
const ORDER: Grade[] = ["very-low", "low", "moderate", "high"];

/** Highest confidence (0 to 100) a report may declare at each grade. */
export const CONFIDENCE_CAP: Record<Grade, number> = { high: 100, moderate: 80, low: 60, "very-low": 40 };

export interface FindingGrade {
	excerpt: string;
	grade: Grade;
	domains: string[];
	bestTier: number | null;
	reason: string;
}

const SECOND_LEVEL = new Set(["co", "com", "org", "ac", "gov", "edu", "net"]);

/** Registrable domain, approximated: last two labels, or three under a co.uk style suffix. */
export function registrableDomain(url: string): string {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
	const labels = host.split(".");
	if (labels.length <= 2) return host;
	const take = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
	return labels.slice(-take).join(".");
}

export function gradeFindings(report: string, ledger: SourceLedger): { findings: FindingGrade[]; overall: Grade | null } {
	const body = sectionBody(report, "Findings");
	const findings: FindingGrade[] = [];
	for (const line of (body ?? "").split("\n")) {
		const urls = [...new Set(extractUrls(line).map(normalizeUrl))];
		if (!urls.length) continue;
		const extracted = urls.filter((url) => ledger.source(url)?.extracted);
		const excerpt = line.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
		if (!extracted.length) {
			findings.push({ excerpt, grade: "very-low", domains: [], bestTier: null, reason: "no cited source was extracted" });
			continue;
		}
		const domains = [...new Set(extracted.map(registrableDomain).filter(Boolean))];
		const bestTier = Math.min(...extracted.map((url) => ledger.source(url)?.tier ?? classifyTier(url)));
		const tierPoints = [0, 3, 2, 1, 0][bestTier] ?? 0;
		const corroboration = domains.length >= 3 ? 2 : domains.length === 2 ? 1 : 0;
		const score = tierPoints + corroboration;
		const grade: Grade = score >= 4 ? "high" : score >= 2 ? "moderate" : score >= 1 ? "low" : "very-low";
		findings.push({ excerpt, grade, domains, bestTier, reason: `best tier ${bestTier}, ${domains.length} independent domain${domains.length === 1 ? "" : "s"}` });
	}
	const overall = findings.length ? findings.map((f) => f.grade).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] : null;
	return { findings, overall };
}
