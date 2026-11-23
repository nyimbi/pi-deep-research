/** robots.txt (RFC 9309) for fetches the tool chose. User-typed URLs skip it. */

export const ROBOTS_AGENT = "PiDeepResearch";

interface Rule {
	allow: boolean;
	pattern: RegExp;
	length: number;
}

function compile(path: string): RegExp {
	const anchored = path.endsWith("$");
	const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Rules of the most specific group naming `agent`, else the `*` group. */
export function parseRobots(text: string, agent = ROBOTS_AGENT): Rule[] {
	const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
	let current: { agents: string[]; rules: Rule[] } | null = null;
	let lastWasAgent = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "").trim();
		const at = line.indexOf(":");
		if (at < 0) continue;
		const key = line.slice(0, at).trim().toLowerCase();
		const value = line.slice(at + 1).trim();
		if (key === "user-agent") {
			if (!current || !lastWasAgent) {
				current = { agents: [], rules: [] };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if (!current || (key !== "allow" && key !== "disallow")) continue;
		if (key === "disallow" && value === "") continue;
		current.rules.push({ allow: key === "allow", pattern: compile(value), length: value.length });
	}
	const name = agent.toLowerCase();
	const named = groups.filter((g) => g.agents.some((a) => a !== "*" && name.includes(a)));
	const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
	return chosen.flatMap((g) => g.rules);
}

/** Longest matching rule wins; on a tie Allow wins. No match means allowed. */
export function allowedByRules(rules: Rule[], pathAndQuery: string): boolean {
	let best: Rule | null = null;
	for (const rule of rules) {
		if (!rule.pattern.test(pathAndQuery)) continue;
		if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
	}
	return best ? best.allow : true;
}

export interface RobotsVerdict {
	allowed: boolean;
	reason: string;
}

export class RobotsChecker {
	private readonly cache = new Map<string, Promise<Rule[] | "deny">>();

	private readonly fetchImpl: typeof fetch;
	private readonly agent: string;

	constructor(fetchImpl: typeof fetch = globalThis.fetch, agent = ROBOTS_AGENT) {
		this.fetchImpl = fetchImpl;
		this.agent = agent;
	}

	private load(origin: string): Promise<Rule[] | "deny"> {
		let hit = this.cache.get(origin);
		if (!hit) {
			hit = (async () => {
				try {
					const res = await this.fetchImpl(`${origin}/robots.txt`, { headers: { "User-Agent": `${this.agent}/1.0` }, signal: AbortSignal.timeout(10_000), redirect: "follow" });
					if (res.status >= 500) return "deny" as const;
					if (!res.ok) return [];
					return parseRobots((await res.text()).slice(0, 512 * 1024), this.agent);
				} catch {
					// Unreachable robots.txt for a network reason is not a reason to block a page that may load.
					return [];
				}
			})();
			this.cache.set(origin, hit);
		}
		return hit;
	}

	async check(url: string): Promise<RobotsVerdict> {
		const u = new URL(url);
		const rules = await this.load(u.origin);
		if (rules === "deny") return { allowed: false, reason: `${u.origin}/robots.txt returned a server error, treated as disallow (RFC 9309)` };
		return allowedByRules(rules, `${u.pathname}${u.search}`) ? { allowed: true, reason: "" } : { allowed: false, reason: `${u.origin}/robots.txt disallows ${u.pathname}` };
	}
}
