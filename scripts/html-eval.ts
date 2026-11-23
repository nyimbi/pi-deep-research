#!/usr/bin/env node
// Usage: node scripts/html-eval.ts [pages.json]. Mean token F1 per page type, local extractor vs the old regex strip.
import { readFile } from "node:fs/promises";
import { baselineStrip, evaluateHtml, local, type HtmlFixturePage } from "../src/html-eval.ts";

const file = process.argv[2] ?? new URL("../test/fixtures/html/pages.json", import.meta.url).pathname;
const pages = JSON.parse(await readFile(file, "utf8")) as HtmlFixturePage[];
const a = evaluateHtml(pages, local);
const b = evaluateHtml(pages, baselineStrip);
console.log(`${file} (${pages.length} pages)`);
for (const type of Object.keys(a)) console.log(`  ${type.padEnd(8)} local ${a[type].toFixed(2)}  baseline ${b[type].toFixed(2)}`);
