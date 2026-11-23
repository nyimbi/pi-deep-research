/** Wayback Machine fallback: public snapshots only, no paywall bypass. */

export interface Snapshot {
	/** Raw-page URL on web.archive.org. */
	url: string;
	/** YYYYMMDDhhmmss as the archive reports it. */
	timestamp: string;
}

/** Statuses worth an archive lookup. 401 and 402 are walls, not outages, and are never routed around. */
export function wayBackEligible(status: number): boolean {
	return status === 403 || status === 404 || status === 410 || (status >= 500 && status < 600);
}

export async function findSnapshot(url: string, options: { timestamp?: string; fetchImpl?: typeof fetch } = {}): Promise<Snapshot | null> {
	const api = new URL("https://archive.org/wayback/available");
	api.searchParams.set("url", url);
	if (options.timestamp) api.searchParams.set("timestamp", options.timestamp);
	const res = await (options.fetchImpl ?? globalThis.fetch)(api.toString(), { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) return null;
	const body = (await res.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string; status?: string } } };
	const closest = body.archived_snapshots?.closest;
	if (!closest?.available || !closest.url || !closest.timestamp || !/^\d{14}$/.test(closest.timestamp)) return null;
	if (closest.status && !closest.status.startsWith("2")) return null;
	const snap = new URL(closest.url);
	// Only an archive host is acceptable: the response is untrusted data.
	if (snap.hostname !== "web.archive.org" || snap.protocol !== "https:" && snap.protocol !== "http:") return null;
	snap.protocol = "https:";
	// The `id_` flag serves the original bytes without the archive's toolbar.
	snap.pathname = snap.pathname.replace(/^\/web\/(\d{14})(?:id_)?\//, "/web/$1id_/");
	return { url: snap.toString(), timestamp: closest.timestamp };
}
