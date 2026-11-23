/** Narrow local LLM client: Ollama chat, schema-constrained JSON, no tools, bounded failure. */

export class LlmError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LlmError";
	}
}

export interface LlmOptions {
	baseUrl: string;
	model: string;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	/** Consecutive failures before calls are refused until `cooldownMs` passes. */
	failureLimit?: number;
	cooldownMs?: number;
	now?: () => number;
	/** Called once per attempted call, for ledger accounting. */
	onCall?: (purpose: string, ok: boolean) => void;
}

export interface LlmClient {
	readonly model: string;
	/** One call, system plus user message, reply parsed as JSON under `schema`. Throws LlmError. */
	json<T>(purpose: string, system: string, user: string, schema: Record<string, unknown>): Promise<T>;
	stats(): { calls: number; failures: number };
}

export function createOllamaLlm(options: LlmOptions): LlmClient {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const now = options.now ?? Date.now;
	const limit = options.failureLimit ?? 3;
	const cooldown = options.cooldownMs ?? 60_000;
	let consecutive = 0;
	let openUntil = 0;
	let calls = 0;
	let failures = 0;
	return {
		model: options.model,
		stats: () => ({ calls, failures }),
		async json<T>(purpose: string, system: string, user: string, schema: Record<string, unknown>): Promise<T> {
			if (now() < openUntil) throw new LlmError(`local model ${options.model} is cooling down after repeated failures`);
			calls += 1;
			try {
				const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}/api/chat`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: options.model,
						stream: false,
						think: false,
						format: schema,
						options: { temperature: 0 },
						messages: [
							{ role: "system", content: system },
							{ role: "user", content: user },
						],
					}),
					signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
				});
				if (!response.ok) throw new LlmError(`ollama chat ${response.status}: ${(await response.text().catch(() => "")).slice(0, 160)}`);
				const data = (await response.json()) as { message?: { content?: string } };
				let parsed: unknown;
				try {
					parsed = JSON.parse(data.message?.content ?? "");
				} catch {
					throw new LlmError("model reply was not valid JSON");
				}
				consecutive = 0;
				options.onCall?.(purpose, true);
				return parsed as T;
			} catch (error) {
				failures += 1;
				consecutive += 1;
				if (consecutive >= limit) openUntil = now() + cooldown;
				options.onCall?.(purpose, false);
				throw error instanceof LlmError ? error : new LlmError(error instanceof Error ? error.message : String(error));
			}
		},
	};
}
