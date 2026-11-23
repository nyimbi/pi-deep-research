/**
 * Turn a research report and its session ledger into a docs/research package:
 * README with the required sections, archived source copies, a hashed index,
 * and citation validation against the ledger.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { LedgerStats, SourceLedger } from "./ledger.ts";
import type { EntailmentReport } from "./entailment.ts";
import { checkReportAgainstNotes, loadNotes } from "./notes.ts";
import { CONFIDENCE_CAP, gradeFindings, type FindingGrade, type Grade } from "./grade.ts";
import { checkClaims, describeClaimIssues } from "./claim-check.ts";
import { checkDiagrams, embedRenderedDiagrams, lintDiagrams, mermaidBlocks } from "./diagrams.ts";
import { evidenceGraph } from "./evidence-graph.ts";
import type { DiagramRenderer } from "./diagram-render.ts";
import type { DocsQaRunner } from "./docs-qa.ts";
import { extractUrls, hostOf, normalizeUrl } from "./normalize.ts";

export const REQUIRED_HEADINGS = [
	"## Question",
	"## Findings",
	"## Decisions",
	"## Rejected options",
	"## Confidence",
	"## Gaps",
	"## Scope",
	"## Contradictions",
	"## Sources",
] as const;

/** Text under a `## Heading` up to the next `## ` heading. */
export function sectionBody(report: string, heading: string): string | null {
	const lines = report.split("\n");
	const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
	if (start < 0) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^##\s/.test(line));
	return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

const EMPTY_ANSWER = /^[\s\-*]*(none|n\/a|nothing|no gaps?|none recorded|not applicable)\b[\s.]*$/i;

/**
 * Content rules for the sections that keep a report honest: scope, gaps and
 * contradictions must say something. Returns messages; the caller decides
 * whether they fail finalization.
 */
export function checkHonestySections(report: string): string[] {
	const issues: string[] = [];
	const scope = sectionBody(report, "Scope");
	if (scope !== null && !(/in scope/i.test(scope) && /out of scope/i.test(scope))) {
		issues.push("## Scope must state what is in scope and what is out of scope");
	}
	const gaps = sectionBody(report, "Gaps");
	if (gaps !== null && (!gaps || gaps.split("\n").every((line) => !line.trim() || EMPTY_ANSWER.test(line)))) {
		issues.push("## Gaps is empty or only says none; name at least one limit, unanswered question or weak source");
	}
	const contradictions = sectionBody(report, "Contradictions");
	if (contradictions !== null) {
		const entries = contradictions.split("\n").filter((line) => /^\s*[-*]\s+\S/.test(line));
		const noneFound = /^[\s\-*]*none found\b/i.test(contradictions);
		if (!entries.length && !noneFound) issues.push("## Contradictions must list conflicts or say 'None found after checking N sources.'");
		for (const entry of entries) {
			if (/^\s*[-*]\s+none found\b/i.test(entry)) continue;
			if (new Set(extractUrls(entry).map(normalizeUrl)).size < 2) {
				issues.push(`## Contradictions entry cites fewer than two distinct sources: "${entry.trim().slice(0, 80)}"`);
			}
		}
	}
	return issues;
}

const INDEX_HEADER = `# Sources

Archived evidence for this research package. Every row points at a file in this
directory; the SHA-256 is what the validator recomputes.

| # | Title | URL | Accessed | File | SHA256 | Tier |
|---|-------|-----|----------|------|--------|------|
`;

export interface FinalizeOptions {
	cwd: string;
	slug?: string;
	question: string;
	depth: string;
	confidence?: number;
	report?: string;
	reportPath?: string;
	decisions?: string[];
	rejectedOptions?: string[];
	gaps?: string[];
	ledger: SourceLedger;
	archiveRoot: string;
	strict?: boolean;
	/** Runs the docs-qa gate over the written report; omit to skip. */
	docsQa?: DocsQaRunner;
	/** Local-model claim-to-passage check; omit to skip. Findings are warnings, never errors. */
	/** Renders each Mermaid block; a render error fails a strict run and the SVG is written to diagrams/. Omit to skip. */
	renderDiagram?: DiagramRenderer;
	entailment?: (report: string) => Promise<EntailmentReport>;
	now?: Date;
}

export interface FinalizeResult {
	packagePath: string;
	readmePath: string;
	indexPath: string;
	errors: string[];
	warnings: string[];
	archived: number;
	pages: number;
	sources: number;
	citations: { known: string[]; unknown: string[] };
	stats: LedgerStats;
	evidenceGrade: { overall: Grade | null; findings: FindingGrade[] };
}

/** Resolve a relative archive root against the enclosing git repository, not the cwd. */
export function resolveArchiveRoot(cwd: string, archiveRoot: string): string {
	if (isAbsolute(archiveRoot)) return archiveRoot;
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) return join(current, archiveRoot);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return join(resolve(cwd), archiveRoot);
}

function slugify(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function cell(value: string): string {
	return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function bullets(items: string[] | undefined, fallback: string): string {
	const values = (items ?? []).map((item) => item.trim()).filter(Boolean);
	return values.length ? values.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

export function ensureSections(
	report: string,
	options: Pick<FinalizeOptions, "question" | "confidence" | "decisions" | "rejectedOptions" | "gaps">,
): { report: string; warnings: string[] } {
	const warnings: string[] = [];
	let text = report.trim();
	if (!/^#\s+/m.test(text)) {
		text = `# ${options.question}\n\n${text}`;
		warnings.push("report had no H1; added the question as the title");
	}
	const additions: string[] = [];
	if (!text.includes("## Question")) additions.push(`## Question\n\n${options.question}`);
	if (!text.includes("## Findings")) additions.push("## Findings\n\n- See the report body above.");
	if (!text.includes("## Decisions")) additions.push(`## Decisions\n\n${bullets(options.decisions, "None recorded.")}`);
	if (!text.includes("## Rejected options")) additions.push(`## Rejected options\n\n${bullets(options.rejectedOptions, "None recorded.")}`);
	if (!text.includes("## Confidence")) {
		const confidence = typeof options.confidence === "number" ? `${Math.round(options.confidence)}%` : "not stated";
		additions.push(`## Confidence\n\n- Level: ${confidence}\n- Why: see the checkpoint history.`);
	}
	if (!text.includes("## Gaps")) additions.push(`## Gaps\n\n${bullets(options.gaps, "None recorded.")}`);
	if (!text.includes("## Sources")) additions.push("## Sources\n\nSee [sources/INDEX.md](sources/INDEX.md).");
	if (additions.length) {
		text = `${text}\n\n${additions.join("\n\n")}\n`;
		warnings.push(`added missing sections: ${additions.map((block) => block.split("\n")[0]).join(", ")}`);
	}
	return { report: text.endsWith("\n") ? text : `${text}\n`, warnings };
}

function sha256(data: string | Uint8Array): string {
	return createHash("sha256").update(typeof data === "string" ? data : Buffer.from(data)).digest("hex");
}

function indexRows(text: string): Array<{ url: string; file: string; digest: string }> {
	const rows: Array<{ url: string; file: string; digest: string }> = [];
	for (const line of text.split("\n")) {
		const match = line.match(/^\|\s*\d+\s*\|(.*)\|\s*$/);
		if (!match) continue;
		const cells = match[1].split("|").map((value) => value.trim());
		if (cells.length < 6) continue;
		rows.push({ url: cells[1], file: cells[3].replace(/`/g, ""), digest: cells[4].replace(/`/g, "") });
	}
	return rows;
}

export function validatePackage(packagePath: string, readme: string, index: string, files: Map<string, string | Uint8Array>): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const heading of REQUIRED_HEADINGS) {
		if (!readme.includes(heading)) errors.push(`README is missing '${heading}'`);
	}
	const rows = indexRows(index);
	const indexedUrls = new Set(rows.map((row) => normalizeUrl(row.url)));
	for (const raw of extractUrls(readme)) {
		if (!indexedUrls.has(normalizeUrl(raw))) errors.push(`README cites an unindexed URL: ${raw}`);
	}
	for (const row of rows) {
		if (!row.file || row.file === "-") {
			warnings.push(`source ${row.url} has no archived file`);
			continue;
		}
		const content = files.get(row.file);
		if (content === undefined) {
			errors.push(`index points at a missing file: ${row.file}`);
			continue;
		}
		if (row.digest && sha256(content) !== row.digest) errors.push(`digest mismatch for ${row.file}`);
	}
	const listed = new Set(rows.map((row) => row.file).filter((file) => file && file !== "-"));
	for (const file of files.keys()) {
		if (!listed.has(file)) errors.push(`unindexed source file: ${file}`);
	}
	return { errors, warnings };
}

export async function writeResearchPackage(options: FinalizeOptions): Promise<FinalizeResult> {
	const slug = options.slug ?? slugify(options.question);
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
		throw new Error(`invalid research slug: ${slug || "(empty)"}`);
	}
	const root = resolveArchiveRoot(options.cwd, options.archiveRoot);
	const packagePath = join(root, slug);
	const sourcesDir = join(packagePath, "sources");
	const readmePath = join(packagePath, "README.md");
	const indexPath = join(sourcesDir, "INDEX.md");

	let report = options.report ?? "";
	if (!report && options.reportPath) {
		try {
			report = await readFile(resolve(options.cwd, options.reportPath), "utf8");
		} catch (error) {
			throw new Error(`cannot read report at ${options.reportPath}: ${(error as Error).message}`);
		}
	}
	if (!report.trim()) throw new Error("provide report text or a readable report_path");
	const ensured = ensureSections(report, options);
	report = ensured.report;
	warnings.push(...ensured.warnings);

	const notes = await loadNotes(join(root, slug));
	if (notes) {
		const noteIssues = checkReportAgainstNotes(report, notes, options.depth);
		if (options.strict !== false) errors.push(...noteIssues.errors);
		else warnings.push(...noteIssues.errors);
		warnings.push(...noteIssues.warnings);
	}
	const graded = gradeFindings(report, options.ledger);
	if (graded.overall && options.confidence !== undefined && options.confidence > CONFIDENCE_CAP[graded.overall]) {
		warnings.push(`declared confidence ${options.confidence} exceeds the ${CONFIDENCE_CAP[graded.overall]} cap for the weakest finding (${graded.overall}); set it from the evidence grade`);
	}
	for (const finding of graded.findings.filter((f) => f.grade === "very-low")) {
		warnings.push(`very-low evidence: "${finding.excerpt}" (${finding.reason})`);
	}

	const honesty = checkHonestySections(report);
	if (options.strict !== false) errors.push(...honesty);
	else warnings.push(...honesty);

	const citations = options.ledger.citations(report);
	if (citations.unknown.length && options.strict !== false) {
		errors.push(`report cites ${citations.unknown.length} URL(s) the tools never returned: ${citations.unknown.join(", ")}`);
	}
	if (citations.known.length === 0) errors.push("report cites no source returned by the search tools");

	const claimIssues = describeClaimIssues(checkClaims(report, (url) => options.ledger.source(url)?.extracted?.content));
	if (options.strict !== false) errors.push(...claimIssues);
	else warnings.push(...claimIssues);

	warnings.push(...lintDiagrams(report));
	const diagramIssues = checkDiagrams(report, options.ledger);
	if (options.strict !== false) errors.push(...diagramIssues);
	else warnings.push(...diagramIssues);

	const graph = evidenceGraph(report, options.ledger);
	const renders: Array<{ index: number; source: string; svg: string }> = [];
	if (options.renderDiagram) {
		for (const block of mermaidBlocks(report)) {
			const out = await options.renderDiagram(block.source);
			if (out.svg) renders.push({ index: block.index, source: block.source, svg: out.svg });
			else (options.strict !== false && !out.unavailable ? errors : warnings).push(`diagram ${block.index} does not render: ${out.error ?? "no output"}`);
		}
	}

	const cited = new Set(citations.known.map((url) => normalizeUrl(url)));
	const entries = options.ledger
		.all()
		.filter((source) => cited.has(source.normalizedUrl) || Boolean(source.extracted));
	const files = new Map<string, string | Uint8Array>();
	const rows: string[] = [];
	let archived = 0;
	let pages = 0;
	for (const [index, source] of entries.entries()) {
		let fileName = "-";
		let digest = "-";
		if (source.extracted) {
			const host = hostOf(source.url) || "source";
			fileName = `${host.replace(/[^a-z0-9.-]/gi, "_")}-${source.extracted.digest.slice(0, 12)}.md`;
			const content = [
				"---",
				`title: ${JSON.stringify(source.extracted.title)}`,
				`url: ${JSON.stringify(source.url)}`,
				`fetched_at: ${JSON.stringify(source.extracted.fetchedAt)}`,
				`provider: ${JSON.stringify(source.extracted.provider)}`,
				`tier: ${source.tier}`,
				"---",
				"",
				source.extracted.content,
			].join("\n");
			files.set(fileName, content);
			digest = sha256(content);
			archived += 1;
		} else if (cited.has(source.normalizedUrl)) {
			const message = `cited source was never extracted: ${source.url}`;
			if (options.strict !== false) errors.push(message);
			else warnings.push(message);
		}
		rows.push(
			`| ${rows.length + 1} | ${cell(source.title)} | ${source.url} | ${(options.now ?? new Date()).toISOString().slice(0, 10)} | \`${fileName}\` | \`${digest}\` | Tier ${source.tier} |`,
		);
		if (source.raw) {
			try {
				const bytes = new Uint8Array(await readFile(source.raw.path));
				const host = hostOf(source.url) || "source";
				const rawName = `${host.replace(/[^a-z0-9.-]/gi, "_")}-${source.raw.digest.slice(0, 12)}${source.raw.suffix}`;
				files.set(rawName, bytes);
				rows.push(
					`| ${rows.length + 1} | Page copy: ${cell(source.title)} | ${source.url} | ${(options.now ?? new Date()).toISOString().slice(0, 10)} | \`${rawName}\` | \`${source.raw.digest}\` | Tier ${source.tier} |`,
				);
				pages += 1;
			} catch (error) {
				errors.push(`raw page is missing for ${source.url}: ${(error as Error).message}`);
			}
		} else {
			warnings.push(`no raw page copy archived for ${source.url}`);
		}
	}

	const index = `${INDEX_HEADER}${rows.join("\n")}${rows.length ? "\n" : ""}`;
	const validation = validatePackage(packagePath, report, index, files);
	errors.push(...validation.errors);
	warnings.push(...validation.warnings);

	await mkdir(sourcesDir, { recursive: true });
	for (const [fileName, content] of files) {
		const destination = join(sourcesDir, fileName);
		if (typeof content === "string") await writeFile(destination, content, "utf8");
		else await writeFile(destination, content);
	}
	if (graph) {
		await mkdir(join(packagePath, "diagrams"), { recursive: true });
		await writeFile(join(packagePath, "diagrams", "evidence-graph.mmd"), `${graph}\n`, "utf8");
		const drawn = options.renderDiagram ? await options.renderDiagram(graph) : undefined;
		if (drawn?.svg) await writeFile(join(packagePath, "diagrams", "evidence-graph.svg"), drawn.svg, "utf8");
		else if (drawn?.error) warnings.push(`evidence graph does not render: ${drawn.error}`);
	}
	if (renders.length) {
		await mkdir(join(packagePath, "diagrams"), { recursive: true });
		for (const r of renders) {
			await writeFile(join(packagePath, "diagrams", `diagram-${r.index}.mmd`), r.source, "utf8");
			await writeFile(join(packagePath, "diagrams", `diagram-${r.index}.svg`), r.svg, "utf8");
		}
		await writeFile(join(packagePath, "README.rendered.md"), embedRenderedDiagrams(report, renders.map((r) => r.index)), "utf8");
	}
	await writeFile(indexPath, index, "utf8");
	await writeFile(readmePath, report, "utf8");
	if (options.docsQa) {
		const qa = await options.docsQa(readmePath, packagePath);
		// Same rule as the citation gate: strict turns findings into failures, non-strict reports them.
		if (options.strict !== false) errors.push(...qa.errors);
		else warnings.push(...qa.errors);
		warnings.push(...qa.warnings);
	}
	let entailment: EntailmentReport | null = null;
	if (options.entailment) {
		try {
			entailment = await options.entailment(report);
			for (const f of entailment.findings.filter((f) => f.verdict === "unsupported")) {
				warnings.push(`entailment: the cited passages do not appear to support "${f.excerpt}" (${f.urls.join(", ")})`);
			}
			if (entailment.errors) warnings.push(`entailment: ${entailment.errors} claim(s) could not be judged by the local model`);
		} catch (error) {
			warnings.push(`entailment check did not run: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const stats = options.ledger.stats(report);
	const metadata = {
		type: "avis-research-package-v1",
		slug,
		question: options.question,
		depth: options.depth,
		confidence: options.confidence ?? null,
		created_at: (options.now ?? new Date()).toISOString(),
		report_path: options.reportPath ?? null,
		archive_root: options.archiveRoot,
		archive_root_resolved: root,
		citations: citations.known,
		unknown_citations: citations.unknown,
		archived_sources: archived,
		raw_pages: pages,
		stats,
		evidence_grade: { overall: graded.overall, findings: graded.findings },
		entailment,
		notes: notes ? { findings: notes.findings.length, rubric_satisfied: notes.rubric.filter((r) => r.satisfied).length, rubric_total: notes.rubric.length, revisions: notes.revisions } : null,
		failures: options.ledger.failureLog(),
	};
	await writeFile(join(packagePath, "research-package.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	// Outside sources/: every file in sources/ must be an indexed archive.
	await writeFile(join(packagePath, "ledger.json"), `${JSON.stringify(options.ledger.persist(), null, 2)}\n`, "utf8");

	return {
		packagePath,
		readmePath,
		indexPath,
		errors: [...new Set(errors)],
		warnings: [...new Set(warnings)],
		archived,
		pages,
		sources: entries.length,
		citations,
		stats,
		evidenceGrade: { overall: graded.overall, findings: graded.findings },
	};
}
