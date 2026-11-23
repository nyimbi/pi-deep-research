import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcBlocks, checkCalcs, parseCalc, printsValue } from "../src/calc.ts";

const URL = "https://a.example/lat";
const TEXT = "The p99 latency was 1,830 ms across the run. The budget is stated elsewhere.";
const text = (u: string) => (u === URL ? TEXT : undefined);
const known = (u: string) => u === URL;
const wrap = (body: string, prose = "") => `# T\n\n\`\`\`calc\n${body}\n\`\`\`\n\n${prose}\n`;
const GOOD = `tail = 1830 @ ${URL}\nbudget = 2000 @ assumed\nroom = (budget - tail) / budget * 100`;

describe("parseCalc", () => {
	it("evaluates inputs and formulas in order, with precedence and unary minus", () => {
		const rows = parseCalc(`a = 4 @ assumed\nb = 2 @ assumed\nc = a + b * 3\nd = -(a - b) / 2\ne = 1,000 @ assumed`);
		assert.deepEqual(rows.map((r) => r.value), [4, 2, 10, -1, 1000]);
	});
	it("rejects an undefined name, a forward reference, a duplicate, division by zero, a sourceless input and junk", () => {
		const errs = (s: string) => parseCalc(s).map((r) => r.error ?? "");
		assert.match(errs("x = y + 1")[0]!, /"y" is not defined/);
		assert.match(errs("a = 1 @ assumed\na = 2 @ assumed")[1]!, /defined twice/);
		assert.match(errs("a = 1 @ assumed\nb = a / 0")[1]!, /divides by zero/);
		assert.match(errs("a = 5")[0]!, /names no source/);
		assert.match(errs("a = 1 @ assumed\nb = a ^ 2")[1]!, /"\^" is not allowed/);
		assert.match(errs("what is this")[0]!, /is not "name = value @ source"/);
		assert.match(errs("a = 1 @ assumed\nb = a + 1 @ assumed")[1]!, /takes no source/);
	});
	it("does not evaluate code", () => {
		assert.match(parseCalc("x = process.exit(1)")[0]!.error!, /not allowed|not defined/);
	});
});

describe("printsValue", () => {
	it("matches the value rounded to the decimals printed, and nothing else", () => {
		assert.ok(printsValue("headroom is 8.5% here", 8.5));
		assert.ok(printsValue("about 9 percent", 8.5 + 0.2));
		assert.ok(printsValue("1,830 ms", 1830));
		assert.ok(!printsValue("headroom is 8.4%", 8.5));
		assert.ok(!printsValue("no numbers", 8.5));
	});
});

describe("checkCalcs", () => {
	it("passes a block whose inputs are in the source and whose derived sentence prints the value", () => {
		assert.deepEqual(checkCalcs(wrap(GOOD, "Headroom is 8.5% of budget (derived: room)."), text, known), []);
	});
	it("fails an input that is not in the cited source, an unknown source and a never-extracted one", () => {
		assert.match(checkCalcs(wrap(`tail = 1900 @ ${URL}`), text, known)[0]!, /1900, which does not appear/);
		assert.match(checkCalcs(wrap("t = 1 @ https://nope.example/x"), text, known)[0]!, /never returned/);
		assert.match(checkCalcs(wrap(`t = 1830 @ ${URL}`), () => undefined, known)[0]!, /never extracted/);
	});
	it("fails a derived sentence that prints a different number and one that names nothing defined", () => {
		assert.match(checkCalcs(wrap(GOOD, "Headroom is 9.5% of budget (derived: room)."), text, known)[0]!, /does not print 8\.5/);
		assert.match(checkCalcs(wrap(GOOD, "It is 3 (derived: nothing)."), text, known)[0]!, /no calc block defines it/);
	});
	it("does not read a number from the calc block itself as the sentence", () => {
		assert.equal(calcBlocks(wrap(GOOD)).length, 1);
		assert.deepEqual(checkCalcs(wrap(GOOD), text, known), []);
	});
});
