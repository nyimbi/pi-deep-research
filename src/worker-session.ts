/** One isolated worker: a fresh in-memory agent session with only the research tools and no extensions loaded. */
import { WORKER_PROMPT } from "./workers.ts";

export interface WorkerSessionDeps {
	cwd: string;
	model: unknown;
	/** Tool definitions captured from the extension, keyed by name. */
	tools: Record<string, unknown>;
	toolNames: string[];
}

export function lastAssistantText(messages: Array<{ role?: string; content?: unknown }>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			const text = m.content.filter((p): p is { type: string; text: string } => Boolean(p) && typeof p === "object" && (p as { type?: string }).type === "text").map((p) => p.text).join("\n");
			if (text.trim()) return text;
		}
	}
	return "";
}

export function createWorkerRunner(deps: WorkerSessionDeps): (question: string, signal: AbortSignal) => Promise<string> {
	return async (question, signal) => {
		const sdk = await import("@earendil-works/pi-coding-agent");
		const resourceLoader = new sdk.DefaultResourceLoader({
			cwd: deps.cwd,
			agentDir: sdk.getAgentDir(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
			systemPromptOverride: () => WORKER_PROMPT,
		});
		await resourceLoader.reload();
		const { session } = await sdk.createAgentSession({
			cwd: deps.cwd,
			model: deps.model as never,
			tools: deps.toolNames,
			customTools: deps.toolNames.map((name) => deps.tools[name]) as never,
			resourceLoader,
			sessionManager: sdk.SessionManager.inMemory(),
		});
		const onAbort = () => void session.abort();
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			await session.prompt(`Sub-question: ${question}`);
			if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("worker aborted");
			return lastAssistantText(session.messages as never);
		} finally {
			signal.removeEventListener("abort", onAbort);
			session.dispose();
		}
	};
}
