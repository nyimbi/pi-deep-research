/**
 * Renders one Mermaid block with the local `mmdc` CLI. The parse error is the product: a block that
 * the structural check passes can still fail to render, and finalize should say so.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagramSettings } from "./settings.ts";

export interface DiagramRender {
	svg?: string;
	error?: string;
}
export type DiagramRenderer = (source: string) => Promise<DiagramRender>;

export function createMmdcRenderer(settings: DiagramSettings): DiagramRenderer {
	return async (source) => {
		const dir = await mkdtemp(join(tmpdir(), "pi-mmd-"));
		try {
			const input = join(dir, "in.mmd");
			const output = join(dir, "out.svg");
			await writeFile(input, source, "utf8");
			const failure = await new Promise<string | null>((resolve) => {
				execFile(settings.mmdc, ["-i", input, "-o", output, "-q"], { timeout: settings.timeoutMs, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
					if (!error) return resolve(null);
					const line = `${stderr}`.split("\n").map((l) => l.trim()).find((l) => /error|expecting|parse|syntax/i.test(l)) ?? error.message;
					resolve(line.slice(0, 200));
				});
			});
			if (failure) return { error: failure };
			return { svg: await readFile(output, "utf8") };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	};
}
