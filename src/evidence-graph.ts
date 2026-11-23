/**
 * A claim-to-source graph drawn from the ledger: each Findings line that cites sources is a node,
 * each cited registrable domain another, and the edge says which tier of source supports it. This
 * is the one diagram only this pipeline can draw, because the ledger knows what was read.
 */
import { gradeFindings, registrableDomain } from "./grade.ts";
import type { SourceLedger } from "./ledger.ts";
import { classifyTier, extractUrls, normalizeUrl } from "./normalize.ts";

const safe = (text: string) => text.replace(/["\[\]()<>{}|`]/g, "").trim();

/** Mermaid text, or null when the Findings section cites nothing. */
export function evidenceGraph(report: string, ledger: SourceLedger): string | null {
	const section = /^##\s+Findings\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(report)?.[1] ?? "";
	const lines = section.split("\n").filter((line) => extractUrls(line).length > 0);
	if (!lines.length) return null;
	const graded = gradeFindings(report, ledger).findings;
	const out = ["flowchart LR"];
	const domains = new Map<string, string>();
	const edges: string[] = [];
	lines.forEach((line, i) => {
		const id = /\[(F\d+)\]/.exec(line)?.[1] ?? `finding ${i + 1}`;
		const node = `f${i}`;
		const grade = graded[i]?.grade ?? "unknown";
		out.push(`  ${node}["${safe(id)} (${grade})"]`);
		for (const url of new Set(extractUrls(line).map(normalizeUrl))) {
			const domain = registrableDomain(url) || url;
			if (!domains.has(domain)) domains.set(domain, `d${domains.size}`);
			const tier = ledger.source(url)?.tier ?? classifyTier(url);
			const read = ledger.source(url)?.extracted ? "read" : "not read";
			edges.push(`  ${node} -->|tier ${tier}, ${read}| ${domains.get(domain)}`);
		}
	});
	for (const [domain, node] of domains) out.push(`  ${node}[("${safe(domain)}")]`);
	out.push(...edges);
	return out.join("\n");
}
