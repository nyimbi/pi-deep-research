/**
 * Durable research notes: sub-questions, findings with evidence IDs, gaps, a rubric and a
 * revision count, stored beside the package so a run survives a context reset. Findings
 * are the only way the report gets evidence IDs, and finalize checks the report against them.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceLedger } from "./ledger.ts";
import { extractUrls, normalizeUrl } from "./normalize.ts";
import { sectionBody } from "./research-package.ts";

export interface Notes {
	slug: string;
	question: string;
	subQuestions: Array<{ id: string; question: string }>;
	findings: Array<{ id: string; subQuestion: string; text: string; urls: string[] }>;
	gaps: string[];
	rubric: Array<{ id: string; text: string; tier: "mandatory" | "optional"; satisfied: boolean }>;
	revisions: number;
	updatedAt: string;
}

export const NOTES_FILE = "notes.json";

export function newNotes(slug: string, question: string, subQuestions: string[], rubric: Array<{ text: string; tier?: "mandatory" | "optional" }> = []): Notes {
	return {
		slug,
		question,
		subQuestions: subQuestions.map((q, i) => ({ id: `Q${i + 1}`, question: q })),
		findings: [],
		gaps: [],
		rubric: rubric.map((r, i) => ({ id: `R${i + 1}`, text: r.text, tier: r.tier ?? "mandatory", satisfied: false })),
		revisions: 0,
		updatedAt: new Date().toISOString(),
	};
}

/** Add a finding. Every URL must already be in the ledger, so notes cannot launder an invented source. */
export function addFinding(notes: Notes, ledger: SourceLedger, subQuestion: string, text: string, urls: string[]): string {
	if (!notes.subQuestions.some((q) => q.id === subQuestion)) throw new Error(`unknown sub-question ${subQuestion}; use one of ${notes.subQuestions.map((q) => q.id).join(", ")}`);
	if (!text.trim()) throw new Error("a finding needs text");
	if (!urls.length) throw new Error("a finding needs at least one source URL");
	const unknown = urls.filter((url) => !ledger.source(url));
	if (unknown.length) throw new Error(`these URLs were never returned by a tool: ${unknown.join(", ")}`);
	const id = `F${notes.findings.length + 1}`;
	notes.findings.push({ id, subQuestion, text: text.trim(), urls: urls.map(normalizeUrl) });
	return id;
}

export function renderNotes(notes: Notes): string {
	const out = [`# Notes: ${notes.question}`, "", "## Sub-questions", ""];
	for (const q of notes.subQuestions) {
		out.push(`- ${q.id} ${q.question}`);
		for (const f of notes.findings.filter((f) => f.subQuestion === q.id)) out.push(`  - [${f.id}] ${f.text} (${f.urls.join(", ")})`);
		if (!notes.findings.some((f) => f.subQuestion === q.id)) out.push("  - no findings yet");
	}
	out.push("", "## Gaps", "", ...(notes.gaps.length ? notes.gaps.map((g) => `- ${g}`) : ["- none recorded yet"]));
	if (notes.rubric.length) {
		out.push("", "## Rubric", "", ...notes.rubric.map((r) => `- [${r.satisfied ? "x" : " "}] ${r.id} (${r.tier}) ${r.text}`));
	}
	out.push("", `Critic revisions recorded: ${notes.revisions}`, "");
	return out.join("\n");
}

export async function saveNotes(dir: string, notes: Notes, ledger: SourceLedger): Promise<void> {
	await mkdir(dir, { recursive: true });
	notes.updatedAt = new Date().toISOString();
	await writeFile(join(dir, NOTES_FILE), `${JSON.stringify(notes, null, 2)}\n`, "utf8");
	await writeFile(join(dir, "notes.md"), renderNotes(notes), "utf8");
	await writeFile(join(dir, "ledger.json"), `${JSON.stringify(ledger.persist(), null, 2)}\n`, "utf8");
}

export async function loadNotes(dir: string): Promise<Notes | null> {
	try {
		return JSON.parse(await readFile(join(dir, NOTES_FILE), "utf8")) as Notes;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** Checks of the finished report against the notes. Errors fail strict finalization. */
export function checkReportAgainstNotes(report: string, notes: Notes, depth: string): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const ids = new Set(notes.findings.map((f) => f.id));
	const cited = new Set<string>();
	for (const line of (sectionBody(report, "Findings") ?? "").split("\n")) {
		if (!/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line) && !extractUrls(line).length) continue;
		const refs = [...line.matchAll(/\[(F\d+)\]/g)].map((m) => m[1]);
		const label = line.replace(/\s+/g, " ").trim().slice(0, 80);
		if (!refs.length) errors.push(`finding has no evidence ID ([F#] from research_notes): "${label}"`);
		for (const ref of refs) {
			if (!ids.has(ref)) errors.push(`evidence ID [${ref}] is not in the notes: "${label}"`);
			else cited.add(ref);
		}
	}
	for (const q of notes.subQuestions) {
		if (!notes.findings.some((f) => f.subQuestion === q.id)) warnings.push(`sub-question ${q.id} has no findings in the notes: "${q.question}"`);
		else if (![...cited].some((id) => notes.findings.find((f) => f.id === id)?.subQuestion === q.id)) warnings.push(`sub-question ${q.id} has findings in the notes but none appear in the report`);
	}
	for (const item of notes.rubric.filter((r) => !r.satisfied)) {
		(item.tier === "mandatory" ? errors : warnings).push(`rubric item ${item.id} (${item.tier}) not satisfied: ${item.text}`);
	}
	if (notes.revisions === 0 && depth !== "quick") warnings.push("no critic revision was recorded; re-read the draft against the rubric and claim checks before finalizing");
	return { errors, warnings };
}
