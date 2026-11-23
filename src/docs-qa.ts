/** Run the vendored docs-qa gate (scripts/docs_qa.py) over a written report. */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";

export interface DocsQaResult {
	errors: string[];
	warnings: string[];
}

export type DocsQaRunner = (reportPath: string, packagePath: string) => Promise<DocsQaResult>;

export const DOCS_QA_SCRIPT = fileURLToPath(new URL("../scripts/docs_qa.py", import.meta.url));

interface Finding {
	severity: string;
	rule: string;
	path: string;
	line: number;
	message: string;
}

/** Fail closed: a gate that cannot run is reported, never treated as a pass. */
export function createDocsQaRunner(python = "python3", script = DOCS_QA_SCRIPT): DocsQaRunner {
	return (reportPath, packagePath) =>
		new Promise((resolve) => {
			execFile(python, ["-I", script, "--json", "--root", packagePath, reportPath], { timeout: 30_000 }, (error, stdout) => {
				try {
					const parsed = JSON.parse(stdout) as { findings: Finding[] };
					const format = (finding: Finding) => `docs-qa ${finding.rule} ${basename(finding.path)}:${finding.line} ${finding.message}`;
					resolve({
						errors: parsed.findings.filter((finding) => finding.severity === "error").map(format),
						warnings: parsed.findings.filter((finding) => finding.severity !== "error").map(format),
					});
				} catch {
					resolve({ errors: [`docs-qa did not run (${python} ${error?.message ?? "no output"}); install Python 3 or fix scripts/docs_qa.py`], warnings: [] });
				}
			});
		});
}
