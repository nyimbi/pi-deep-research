/**
 * One settings object for the extension, read from the same config file the
 * provider chain already uses.
 *
 * Resolution: environment variables override config.json, config.json
 * overrides defaults. A malformed file is a hard error; a missing file is the
 * normal default install.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDERS, parseProviderList, providersConfigPath } from "./config.ts";

export interface CacheSettings {
	enabled: boolean;
	dir: string;
	searchTtlMs: number;
	extractTtlMs: number;
}

export interface BreakerSettings {
	failures: number;
	cooldownMs: number;
}

export interface SearxngSettings {
	baseUrl: string;
	fallbackUrls?: string[];
	language: string;
	categories: string;
	safeSearch: number;
	engines: string[];
}

export interface OllamaSettings {
	enabled: boolean;
	host: string;
	port: string;
}

export interface UocrSettings {
	/** Base URL of the SGLang server; empty disables the provider. */
	baseUrl: string;
	model: string;
	apiKey: string;
	pdftoppm: string;
	dpi: number;
	maxPages: number;
	pagesPerRequest: number;
	tokensPerPage: number;
	cropMode: boolean;
	/** Pre-serialized DeepseekOCRNoRepeatNGramLogitProcessor.to_str(); empty omits it. */
	logitProcessor: string;
	ngramSize: number;
	windowSize: number;
}

export interface SafetySettings {
	allowPrivateHosts: boolean;
	allowedHosts: string[];
	blockedHosts: string[];
	allowedPorts: number[];
}

export interface BudgetSettings {
	maxSearches: number;
	maxExtracts: number;
}

export interface ResearchSettings {
	providers: string[];
	timeoutMs: number;
	retries: number;
	retryBaseMs: number;
	batchConcurrency: number;
	merge: boolean;
	cache: CacheSettings;
	breaker: BreakerSettings;
	searxng: SearxngSettings;
	ollama: OllamaSettings;
	uocr: UocrSettings;
	archiveRoot: string;
	archiveMaxBytes: number;
	safety: SafetySettings;
	budget: BudgetSettings;
}

export const DEFAULT_SETTINGS: ResearchSettings = {
	providers: [...DEFAULT_PROVIDERS],
	timeoutMs: 45_000,
	retries: 2,
	retryBaseMs: 500,
	batchConcurrency: 3,
	merge: false,
	cache: {
		enabled: true,
		dir: join(homedir(), ".pi", "agent", "pi-deep-research", "cache"),
		searchTtlMs: 3_600_000,
		extractTtlMs: 604_800_000,
	},
	breaker: { failures: 3, cooldownMs: 60_000 },
	searxng: { baseUrl: "", fallbackUrls: [], language: "en", categories: "general", safeSearch: 0, engines: [] },
	ollama: { enabled: true, host: "127.0.0.1", port: "11434" },
	uocr: {
		baseUrl: "",
		model: "Unlimited-OCR-2",
		apiKey: "",
		pdftoppm: "pdftoppm",
		dpi: 150,
		maxPages: 40,
		pagesPerRequest: 20,
		tokensPerPage: 8000,
		cropMode: true,
		logitProcessor: "",
		ngramSize: 35,
		windowSize: 1024,
	},
	archiveRoot: join("docs", "research"),
	archiveMaxBytes: 5 * 1024 * 1024,
	safety: {
		allowPrivateHosts: false,
		allowedHosts: [],
		blockedHosts: [],
		allowedPorts: [80, 443],
	},
	budget: { maxSearches: 80, maxExtracts: 60 },
};

type Env = Record<string, string | undefined>;

function expandHome(path: string): string {
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (value === undefined) return {};
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid ${name}: expected an object`);
	}
	return value as Record<string, unknown>;
}

function number(value: unknown, fallback: number, name: string, min = 0): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
		throw new Error(`Invalid ${name}: expected a number >= ${min}`);
	}
	return value;
}

function bool(value: unknown, fallback: boolean, name: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") throw new Error(`Invalid ${name}: expected a boolean`);
	return value;
}

function text(value: unknown, fallback: string, name: string): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string") throw new Error(`Invalid ${name}: expected a string`);
	return value;
}

function strings(value: unknown, fallback: string[], name: string): string[] {
	if (value === undefined) return fallback;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid ${name}: expected an array of strings`);
	}
	return value.map((item) => item.trim()).filter(Boolean);
}

function numbers(value: unknown, fallback: number[], name: string): number[] {
	if (value === undefined) return fallback;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
		throw new Error(`Invalid ${name}: expected an array of numbers`);
	}
	return value;
}

export interface LoadSettingsOptions {
	env?: Env;
	configPath?: string;
	home?: string;
	readFileImpl?: (path: string, encoding: "utf8") => Promise<string>;
}

export async function loadSettings(options: LoadSettingsOptions = {}): Promise<ResearchSettings> {
	const env = options.env ?? process.env;
	const configPath = options.configPath ?? providersConfigPath(options.home ?? homedir());
	let raw: Record<string, unknown> = {};
	try {
		raw = object(JSON.parse(await (options.readFileImpl ?? readFile)(configPath, "utf8")), "config.json");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	const cacheRaw = object(raw.cache, "cache");
	const breakerRaw = object(raw.breaker, "breaker");
	const searxngRaw = object(raw.searxng, "searxng");
	const ollamaRaw = object(raw.ollama, "ollama");
	const uocrRaw = object(raw.unlimited_ocr, "unlimited_ocr");
	const safetyRaw = object(raw.safety, "safety");
	const budgetRaw = object(raw.budget, "budget");
	const archiveRaw = object(raw.archive, "archive");

	const providerSource = env.SEARCH_PROVIDERS ?? (Array.isArray(raw.providers) ? (raw.providers as string[]).join(",") : undefined);
	const providers = parseProviderList(providerSource);
	const envPort = env.OLLAMA_PORT?.trim();
	const envHost = env.OLLAMA_HOST?.trim();

	return {
		providers,
		timeoutMs: number(env.SEARCH_TIMEOUT_MS ? Number(env.SEARCH_TIMEOUT_MS) : raw.timeout_ms, DEFAULT_SETTINGS.timeoutMs, "timeout_ms", 1),
		retries: number(env.SEARCH_RETRIES ? Number(env.SEARCH_RETRIES) : raw.retries, DEFAULT_SETTINGS.retries, "retries"),
		retryBaseMs: number(raw.retry_base_ms, DEFAULT_SETTINGS.retryBaseMs, "retry_base_ms", 1),
		batchConcurrency: number(raw.batch_concurrency, DEFAULT_SETTINGS.batchConcurrency, "batch_concurrency", 1),
		merge: bool(raw.merge, DEFAULT_SETTINGS.merge, "merge"),
		cache: {
			enabled: bool(
				env.PI_RESEARCH_CACHE === "off" ? false : cacheRaw.enabled,
				DEFAULT_SETTINGS.cache.enabled,
				"cache.enabled",
			),
			dir: expandHome(text(cacheRaw.dir, DEFAULT_SETTINGS.cache.dir, "cache.dir")),
			searchTtlMs: number(cacheRaw.search_ttl_seconds, DEFAULT_SETTINGS.cache.searchTtlMs / 1000, "cache.search_ttl_seconds") * 1000,
			extractTtlMs: number(cacheRaw.extract_ttl_seconds, DEFAULT_SETTINGS.cache.extractTtlMs / 1000, "cache.extract_ttl_seconds") * 1000,
		},
		breaker: {
			failures: number(breakerRaw.failures, DEFAULT_SETTINGS.breaker.failures, "breaker.failures", 1),
			cooldownMs: number(breakerRaw.cooldown_seconds, DEFAULT_SETTINGS.breaker.cooldownMs / 1000, "breaker.cooldown_seconds") * 1000,
		},
		searxng: {
			baseUrl: (env.SEARXNG_BASE_URL ?? text(searxngRaw.base_url, DEFAULT_SETTINGS.searxng.baseUrl, "searxng.base_url")).replace(/\/+$/, ""),
			fallbackUrls: (env.SEARXNG_FALLBACK_URLS ? env.SEARXNG_FALLBACK_URLS.split(",") : strings(searxngRaw.fallback_urls, DEFAULT_SETTINGS.searxng.fallbackUrls ?? [], "searxng.fallback_urls"))
				.map((url) => url.trim().replace(/\/+$/, ""))
				.filter(Boolean),
			language: text(searxngRaw.language, DEFAULT_SETTINGS.searxng.language, "searxng.language"),
			categories: text(searxngRaw.categories, DEFAULT_SETTINGS.searxng.categories, "searxng.categories"),
			safeSearch: number(searxngRaw.safe_search, DEFAULT_SETTINGS.searxng.safeSearch, "searxng.safe_search"),
			engines: strings(searxngRaw.engines, DEFAULT_SETTINGS.searxng.engines, "searxng.engines"),
		},
		ollama: {
			enabled: bool(
				env.OLLAMA_WEB_SEARCH === "off" ? false : ollamaRaw.enabled,
				DEFAULT_SETTINGS.ollama.enabled,
				"ollama.enabled",
			),
			host: envHost || text(ollamaRaw.host, DEFAULT_SETTINGS.ollama.host, "ollama.host"),
			port: envPort || text(ollamaRaw.port, DEFAULT_SETTINGS.ollama.port, "ollama.port"),
		},
		uocr: {
			baseUrl: (env.UOCR_BASE_URL ?? text(uocrRaw.base_url, DEFAULT_SETTINGS.uocr.baseUrl, "unlimited_ocr.base_url")).trim().replace(/\/+$/, ""),
			model: text(uocrRaw.model, DEFAULT_SETTINGS.uocr.model, "unlimited_ocr.model"),
			apiKey: env.UOCR_API_KEY ?? text(uocrRaw.api_key, DEFAULT_SETTINGS.uocr.apiKey, "unlimited_ocr.api_key"),
			pdftoppm: text(uocrRaw.pdftoppm, DEFAULT_SETTINGS.uocr.pdftoppm, "unlimited_ocr.pdftoppm"),
			dpi: number(uocrRaw.dpi, DEFAULT_SETTINGS.uocr.dpi, "unlimited_ocr.dpi", 36),
			maxPages: number(uocrRaw.max_pages, DEFAULT_SETTINGS.uocr.maxPages, "unlimited_ocr.max_pages", 1),
			pagesPerRequest: number(uocrRaw.pages_per_request, DEFAULT_SETTINGS.uocr.pagesPerRequest, "unlimited_ocr.pages_per_request", 1),
			tokensPerPage: number(uocrRaw.tokens_per_page, DEFAULT_SETTINGS.uocr.tokensPerPage, "unlimited_ocr.tokens_per_page", 1),
			cropMode: bool(uocrRaw.crop_mode, DEFAULT_SETTINGS.uocr.cropMode, "unlimited_ocr.crop_mode"),
			logitProcessor: text(uocrRaw.logit_processor, DEFAULT_SETTINGS.uocr.logitProcessor, "unlimited_ocr.logit_processor"),
			ngramSize: number(uocrRaw.ngram_size, DEFAULT_SETTINGS.uocr.ngramSize, "unlimited_ocr.ngram_size", 1),
			windowSize: number(uocrRaw.window_size, DEFAULT_SETTINGS.uocr.windowSize, "unlimited_ocr.window_size", 1),
		},
		archiveRoot: expandHome(text(archiveRaw.root, DEFAULT_SETTINGS.archiveRoot, "archive.root")),
		archiveMaxBytes: number(archiveRaw.max_bytes, DEFAULT_SETTINGS.archiveMaxBytes, "archive.max_bytes", 1024),
		safety: {
			allowPrivateHosts: bool(safetyRaw.allow_private_hosts, DEFAULT_SETTINGS.safety.allowPrivateHosts, "safety.allow_private_hosts"),
			allowedHosts: strings(safetyRaw.allowed_hosts, DEFAULT_SETTINGS.safety.allowedHosts, "safety.allowed_hosts").map((host) => host.toLowerCase()),
			blockedHosts: strings(safetyRaw.blocked_hosts, DEFAULT_SETTINGS.safety.blockedHosts, "safety.blocked_hosts").map((host) => host.toLowerCase()),
			allowedPorts: numbers(safetyRaw.allowed_ports, DEFAULT_SETTINGS.safety.allowedPorts, "safety.allowed_ports"),
		},
		budget: {
			maxSearches: number(budgetRaw.max_searches, DEFAULT_SETTINGS.budget.maxSearches, "budget.max_searches"),
			maxExtracts: number(budgetRaw.max_extracts, DEFAULT_SETTINGS.budget.maxExtracts, "budget.max_extracts"),
		},
	};
}
