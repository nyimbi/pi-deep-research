import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { createBrowserProvider } from "../src/native/browser.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const hasPlaywright = (() => { try { execFileSync("python3", ["-c", "import playwright"], { stdio: "ignore" }); return true; } catch { return false; } })();
let server: Server;
let base = "";
const hits: string[] = [];

before(async () => {
	server = createServer((req, res) => {
		hits.push(req.url ?? "");
		res.setHeader("set-cookie", "sid=1");
		if (req.url === "/app2") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<html><body><div id="root"></div><script>
				document.getElementById("root").innerHTML = "<main><h1>Rendered</h1><p>" + "client rendered words ".repeat(40) + "</p></main>";
				fetch("${base.replace("127.0.0.1", "localhost")}/private-api").catch(() => {});
			</script></body></html>`);
			return;
		}
		if (req.url === "/ws-app") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<html><body><div id="root"></div><script>
				document.getElementById("root").innerHTML = "<main><h1>Rendered</h1><p>" + "client rendered words ".repeat(40) + "</p></main>";
				try { new WebSocket("${base.replace("http", "ws")}/socket"); } catch (e) {}
			</script></body></html>`);
			return;
		}
		if (req.url === "/app") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<html><head><title>App</title></head><body><div id="root"></div><script>
				document.getElementById("root").innerHTML = "<main><h1>Rendered</h1><p>" + "client rendered words ".repeat(40) + "</p></main>";
				fetch("${base}/private-api").catch(() => {});
				var i = new Image(); i.src = "${base}/tracker.png";
			</script></body></html>`);
			return;
		}
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("x");
	});
	server.on("upgrade", (req, socket) => {
		hits.push(`upgrade ${req.url}`);
		socket.destroy();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

describe("browser provider", { skip: !hasPlaywright, timeout: 120_000 }, () => {
	const settings = { ...DEFAULT_SETTINGS.browser, enabled: true };
	const policy = { allowPrivateHosts: true, allowedHosts: [], blockedHosts: [], allowedPorts: [] };

	it("is off by default", () => {
		assert.equal(createBrowserProvider(DEFAULT_SETTINGS.browser, { policy }).isConfigured(), false);
	});
	it("extracts a client-rendered page that plain HTML extraction cannot see", async () => {
		const out = await createBrowserProvider(settings, { policy }).extract!(`${base}/app`);
		assert.match(out.content, /Rendered/);
		assert.ok(out.wordCount >= 80);
	});
	it("asks the policy about every subresource and blocks the ones it refuses", async () => {
		hits.length = 0;
		const asked: string[] = [];
		const out = await createBrowserProvider(settings, {
			policy,
			allow: async (url) => {
				asked.push(url);
				return !url.endsWith("/private-api") && !url.endsWith("/tracker.png");
			},
		}).extract!(`${base}/app`);
		assert.match(out.content, /Rendered/);
		assert.ok(asked.some((u) => u.endsWith("/private-api")), "fetch subresource was checked");
		assert.ok(asked.some((u) => u.endsWith("/tracker.png")), "image subresource was checked");
		assert.ok(!hits.includes("/private-api") && !hits.includes("/tracker.png"), `blocked requests never reached the server: ${hits}`);
	});
	it("the real policy refuses a subresource on localhost while the page itself loads", async () => {
		hits.length = 0;
		const out = await createBrowserProvider(settings, { policy }).extract!(`${base}/app2`);
		assert.match(out.content, /Rendered/);
		assert.ok(!hits.includes("/private-api"), `localhost subresource reached the server: ${hits}`);
	});
	it("never lets a page open a WebSocket", async () => {
		hits.length = 0;
		const out = await createBrowserProvider(settings, { policy }).extract!(`${base}/ws-app`);
		assert.match(out.content, /Rendered/);
		assert.ok(!hits.some((h) => h.startsWith("upgrade")), `a WebSocket reached the server: ${hits}`);
	});
});
