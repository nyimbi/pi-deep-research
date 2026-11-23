/**
 * Renders one Mermaid block with the local `mmdc` CLI. The parse error is the product: a block that
 * the structural check passes can still fail to render, and finalize should say so.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { LIGHT } from "./diagram-style.ts";
import type { DiagramSettings } from "./settings.ts";

export interface DiagramRender {
	svg?: string;
	error?: string;
	/** The renderer itself could not run (binary missing), so nothing is known about the diagram. */
	unavailable?: boolean;
}
export type DiagramRenderer = (source: string) => Promise<DiagramRender>;

/** Mermaid's own drawing, themed with the same paper, ink and accent tokens, for diagrams the editorial drawer declines. */
export const MERMAID_THEME = {
	theme: "base",
	themeVariables: {
		background: LIGHT.paper,
		primaryColor: LIGHT.node,
		primaryBorderColor: LIGHT.ink,
		primaryTextColor: LIGHT.ink,
		secondaryColor: LIGHT.node,
		tertiaryColor: LIGHT.paper,
		lineColor: LIGHT.muted,
		textColor: LIGHT.ink,
		fontFamily: "Geist, system-ui, sans-serif",
		fontSize: "13px",
	},
};

/**
 * Runs the diagram-design skill's own checks on an editorial page: the accessible-SVG and document contract
 * (self_check.py) and the six connector rules (verify-geometry.py). Returns one line per finding. A missing
 * skill or python3 returns nothing: the checks are extra, not required.
 */
export async function runDesignGates(htmlPath: string, skillDir: string): Promise<string[]> {
	const out: string[] = [];
	for (const script of ["self_check.py", "verify-geometry.py"]) {
		const path = join(skillDir, "scripts", script);
		if (!existsSync(path)) continue;
		const result = await new Promise<{ failed: boolean; text: string }>((resolve) => {
			execFile("python3", ["-I", path, htmlPath], { timeout: 30_000, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
				const code = (error as { code?: unknown } | null)?.code;
				resolve({ failed: error !== null && code !== "ENOENT", text: `${stdout}\n${stderr}` });
			});
		});
		if (!result.failed) continue;
		const lines = result.text.split("\n").map((l) => l.trim()).filter((l) => l && !/^Summary:|^OK\b/.test(l));
		out.push(`${script} on ${htmlPath.split("/").pop()}: ${(lines[0] ?? "failed").slice(0, 200)}`);
	}
	return out;
}

export function createMmdcRenderer(settings: DiagramSettings): DiagramRenderer {
	return async (source) => {
		const dir = await mkdtemp(join(tmpdir(), "pi-mmd-"));
		try {
			const input = join(dir, "in.mmd");
			const output = join(dir, "out.svg");
			const config = join(dir, "mermaid.json");
			await writeFile(input, source, "utf8");
			await writeFile(config, JSON.stringify(MERMAID_THEME), "utf8");
			let missing = false;
			const failure = await new Promise<string | null>((resolve) => {
				execFile(settings.mmdc, ["-i", input, "-o", output, "-q", "-c", config, "-b", LIGHT.paper], { timeout: settings.timeoutMs, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
					if (!error) return resolve(null);
					if ((error as NodeJS.ErrnoException).code === "ENOENT") missing = true;
					const line = `${stderr}`.split("\n").map((l) => l.trim()).find((l) => /error|expecting|parse|syntax/i.test(l)) ?? error.message;
					resolve(line.slice(0, 200));
				});
			});
			if (failure) return missing ? { error: `${settings.mmdc} is not installed`, unavailable: true } : { error: failure };
			return { svg: await readFile(output, "utf8") };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	};
}
