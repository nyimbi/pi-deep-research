/** Disk cache, retry/backoff, per-provider breaker, and fetch safety policy. */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";

export class JsonCache {
	private readonly dir: string;
	private readonly enabled: boolean;
	private readonly now: () => number;

	constructor(dir: string, options: { enabled?: boolean; now?: () => number } = {}) {
		this.dir = dir;
		this.enabled = options.enabled ?? true;
		this.now = options.now ?? Date.now;
	}

	key(...parts: string[]): string {
		return createHash("sha256").update(parts.join("\u0000")).digest("hex");
	}

	async get<T>(key: string): Promise<T | null> {
		if (!this.enabled) return null;
		try {
			const raw = JSON.parse(await readFile(join(this.dir, `${key}.json`), "utf8")) as { expiresAt: number; value: T };
			if (typeof raw.expiresAt !== "number" || raw.expiresAt <= this.now()) return null;
			return raw.value;
		} catch {
			return null;
		}
	}

	async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
		if (!this.enabled || ttlMs <= 0) return;
		try {
			await mkdir(this.dir, { recursive: true });
			const path = join(this.dir, `${key}.json`);
			const temporary = `${path}.${process.pid}.tmp`;
			await writeFile(temporary, JSON.stringify({ expiresAt: this.now() + ttlMs, value }), "utf8");
			await rename(temporary, path);
		} catch {
			/* a cache failure must never fail a research call */
		}
	}
}

export interface RetryOptions {
	retries: number;
	baseDelayMs: number;
	maxDelayMs?: number;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
	retryStatuses?: number[];
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryAfterMs(response: Response): number | null {
	const value = response.headers.get("retry-after");
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export async function fetchWithRetry(input: string | URL, init: RequestInit = {}, options: RetryOptions): Promise<Response> {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const random = options.random ?? Math.random;
	const statuses = new Set(options.retryStatuses ?? RETRYABLE);
	let lastError: unknown;
	for (let attempt = 0; attempt <= options.retries; attempt += 1) {
		if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
		try {
			const response = await fetchImpl(input, init);
			if (!statuses.has(response.status) || attempt === options.retries) return response;
			const retryAfter = retryAfterMs(response);
			const backoff = Math.min(options.maxDelayMs ?? 15_000, options.baseDelayMs * 2 ** attempt);
			await sleep(retryAfter ?? backoff + Math.floor(random() * options.baseDelayMs));
		} catch (error) {
			if ((error as Error).name === "AbortError") throw error;
			lastError = error;
			if (attempt === options.retries) throw error;
			const backoff = Math.min(options.maxDelayMs ?? 15_000, options.baseDelayMs * 2 ** attempt);
			await sleep(backoff + Math.floor(random() * options.baseDelayMs));
		}
	}
	throw lastError ?? new Error("request failed");
}

export function makeRetryFetch(options: Omit<RetryOptions, "fetchImpl"> & { fetchImpl?: typeof fetch }): typeof fetch {
	return ((input: string | URL | Request, init?: RequestInit) =>
		fetchWithRetry(String(input), init ?? {}, options)) as typeof fetch;
}

export class ProviderBreaker {
	private readonly failures = new Map<string, number>();
	private readonly openUntil = new Map<string, number>();
	private readonly threshold: number;
	private readonly cooldownMs: number;
	private readonly now: () => number;

	constructor(options: { failures: number; cooldownMs: number; now?: () => number }) {
		this.threshold = options.failures;
		this.cooldownMs = options.cooldownMs;
		this.now = options.now ?? Date.now;
	}

	isOpen(provider: string): boolean {
		const until = this.openUntil.get(provider) ?? 0;
		if (until > this.now()) return true;
		if (until > 0) {
			this.openUntil.delete(provider);
			this.failures.delete(provider);
		}
		return false;
	}

	recordSuccess(provider: string): void {
		this.failures.delete(provider);
		this.openUntil.delete(provider);
	}

	recordFailure(provider: string): void {
		const count = (this.failures.get(provider) ?? 0) + 1;
		this.failures.set(provider, count);
		if (count >= this.threshold) this.openUntil.set(provider, this.now() + this.cooldownMs);
	}
}

export interface UrlPolicy {
	allowPrivateHosts: boolean;
	allowedHosts: string[];
	blockedHosts: string[];
	allowedPorts: number[];
}

/** An HTTP failure with its status, so callers can record terminal outcomes instead of retrying. */
export class HttpStatusError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "HttpStatusError";
		this.status = status;
	}
}

export class UnsafeUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsafeUrlError";
	}
}

export function isPrivateAddress(address: string): boolean {
	const kind = isIP(address);
	if (kind === 4) {
		const octets = address.split(".").map(Number);
		const [a, b] = octets;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 198 && (b === 18 || b === 19)) ||
			a >= 224
		);
	}
	if (kind === 6) {
		const value = address.toLowerCase();
		if (value === "::" || value === "::1") return true;
		if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
		const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return isPrivateAddress(mapped[1]);
		return false;
	}
	return false;
}

function hostBlocked(host: string, policy: UrlPolicy): boolean {
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
	if (host === "metadata.google.internal") return true;
	if (policy.blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return true;
	return !policy.allowPrivateHosts && isIP(host) !== 0 && isPrivateAddress(host);
}

export function assertFetchableUrl(raw: string, policy: UrlPolicy): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new UnsafeUrlError(`invalid URL: ${raw}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new UnsafeUrlError(`only http and https are fetchable, got ${url.protocol}`);
	}
	if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are refused");
	const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
	if (policy.allowedPorts.length > 0 && !policy.allowedPorts.includes(port)) {
		throw new UnsafeUrlError(`port ${port} is not in the allowed fetch ports (${policy.allowedPorts.join(", ")})`);
	}
	const host = url.hostname.toLowerCase();
	const explicitlyAllowed = policy.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
	if (!explicitlyAllowed && hostBlocked(host, policy)) {
		throw new UnsafeUrlError(`host ${host} is private, loopback, or blocked by policy`);
	}
	return url;
}

export async function assertFetchableUrlResolved(
	raw: string,
	policy: UrlPolicy,
	resolve: (host: string) => Promise<Array<{ address: string }>> = (host) => lookup(host, { all: true }),
): Promise<URL> {
	const url = assertFetchableUrl(raw, policy);
	const host = url.hostname.toLowerCase();
	const explicitlyAllowed = policy.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
	if (isIP(host) === 0 && !explicitlyAllowed && !policy.allowPrivateHosts) {
		let addresses: Array<{ address: string }>;
		try {
			addresses = await resolve(host);
		} catch {
			return url;
		}
		if (addresses.some((entry) => isPrivateAddress(entry.address))) {
			throw new UnsafeUrlError(`host ${host} resolves to a private address`);
		}
	}
	return url;
}
