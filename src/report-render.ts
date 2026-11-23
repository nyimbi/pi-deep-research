/**
 * Looks at the finished report page in headless Chrome, the way machine-works looks at its frames: at
 * desktop and phone width, fail on horizontal overflow, broken images or script errors; then print the PDF
 * from the same page. A missing browser is a warning, never a failure, like a missing `mmdc`.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];

export function findChrome(configured?: string): string | null {
	for (const path of [configured, process.env.CHROME_PATH, ...CANDIDATES]) if (path && existsSync(path)) return path;
	return null;
}

function run(chrome: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", ...args], { timeout: 60_000, maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
			resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr) });
		});
	});
}

export interface Probe {
	width: number;
	scrollWidth: number;
	brokenImages: string[];
	errors: string[];
	headings: number;
}

/** Injected into a temporary copy only, so the published page carries no test code. */
const PROBE = `<script>(function(){var errs=[];window.addEventListener("error",function(e){errs.push(String(e.message||e.type))});
window.addEventListener("load",function(){setTimeout(function(){var bad=[].slice.call(document.images).filter(function(i){return !i.complete||i.naturalWidth===0}).map(function(i){return (i.alt||i.src).slice(0,60)});
var r={width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,brokenImages:bad,errors:errs,headings:document.querySelectorAll("h2,h3").length};
var p=document.createElement("pre");p.id="probe-result";p.textContent=JSON.stringify(r);document.body.appendChild(p)},50)})})();</script>`;

export async function probeAt(chrome: string, html: string, width: number): Promise<Probe | string> {
	const dir = await mkdtemp(join(tmpdir(), "report-probe-"));
	try {
		const file = join(dir, "page.html");
		await writeFile(file, html.replace(/<head[^>]*>/, (m) => `${m}${PROBE}`), "utf8");
		const out = await run(chrome, [`--window-size=${width},900`, "--virtual-time-budget=4000", "--dump-dom", `file://${file}`]);
		const m = out.stdout.match(/<pre id="probe-result">([\s\S]*?)<\/pre>/);
		if (!m) return `the probe did not report at ${width}px (${out.ok ? "no result" : "chrome failed"})`;
		return JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) as Probe;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** One finding per problem; empty means the page looked right at both widths. */
export async function checkReportPage(chrome: string, html: string): Promise<string[]> {
	const findings: string[] = [];
	for (const width of [1280, 390]) {
		const p = await probeAt(chrome, html, width);
		if (typeof p === "string") {
			findings.push(`report.html: ${p}`);
			continue;
		}
		// The probe's own pixel tolerance: a scrollbar or sub-pixel rounding is not an overflow.
		if (p.scrollWidth > p.width + 2) findings.push(`report.html overflows sideways at ${width}px (page is ${p.scrollWidth}px wide)`);
		for (const img of p.brokenImages) findings.push(`report.html has an image that did not load: ${img}`);
		for (const e of p.errors) findings.push(`report.html raised a script error: ${e}`);
	}
	return [...new Set(findings)];
}

export async function printReportPdf(chrome: string, htmlPath: string, pdfPath: string): Promise<string | null> {
	const out = await run(chrome, ["--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`]);
	if (!existsSync(pdfPath)) return `report.pdf was not written (${out.stderr.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "chrome failed"})`;
	const head = (await readFile(pdfPath)).subarray(0, 5).toString();
	return head === "%PDF-" ? null : "report.pdf is not a PDF";
}
