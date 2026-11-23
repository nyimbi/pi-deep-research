/**
 * Calc blocks: derived numbers in a report come from one place. A fenced `calc` block lists inputs and
 * formulas; finalize recomputes it and checks that every input appears in the archived source it cites and
 * that every sentence marked `(derived: name)` prints the computed value.
 *
 *   ```calc
 *   tail_ms = 1830 @ https://example.com/latency
 *   budget_ms = 2000 @ assumed
 *   headroom = (budget_ms - tail_ms) / budget_ms * 100
 *   ```
 *
 * No eval: a small recursive-descent parser over numbers, names, + - * / and parentheses.
 */
export interface CalcRow {
	name: string;
	value: number | null;
	/** A literal input: its source URL, "assumed", or null for a formula. */
	source: string | null;
	formula: string | null;
	error?: string;
}

export interface CalcBlock {
	index: number;
	start: number;
	end: number;
	rows: CalcRow[];
}

const NAME = /^[A-Za-z_]\w*$/;
const LITERAL = /^-?\d[\d,]*(?:\.\d+)?$/;

export function calcBlocks(report: string): Array<{ index: number; start: number; end: number; source: string }> {
	const out: Array<{ index: number; start: number; end: number; source: string }> = [];
	const re = /^[ \t]*```calc[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(report))) out.push({ index: out.length + 1, start: m.index, end: m.index + m[0].length, source: m[1]! });
	return out;
}

function evaluate(expr: string, scope: Map<string, number>): number {
	const tokens = expr.match(/\d[\d,]*(?:\.\d+)?|[A-Za-z_]\w*|[()+\-*/]|\S/g) ?? [];
	let at = 0;
	const peek = () => tokens[at];
	const take = () => tokens[at++];
	const primary = (): number => {
		const t = take();
		if (t === undefined) throw new Error("the formula ends early");
		if (t === "(") {
			const v = sum();
			if (take() !== ")") throw new Error("a parenthesis is not closed");
			return v;
		}
		if (t === "-") return -primary();
		if (/^\d/.test(t)) return Number(t.replace(/,/g, ""));
		if (NAME.test(t)) {
			const v = scope.get(t);
			if (v === undefined) throw new Error(`"${t}" is not defined above this line`);
			return v;
		}
		throw new Error(`"${t}" is not allowed in a formula`);
	};
	const product = (): number => {
		let v = primary();
		while (peek() === "*" || peek() === "/") {
			const op = take();
			const r = primary();
			if (op === "/" && r === 0) throw new Error("it divides by zero");
			v = op === "*" ? v * r : v / r;
		}
		return v;
	};
	const sum = (): number => {
		let v = product();
		while (peek() === "+" || peek() === "-") v = take() === "+" ? v + product() : v - product();
		return v;
	};
	const v = sum();
	if (at < tokens.length) throw new Error(`"${tokens[at]}" is not allowed in a formula`);
	return v;
}

export function parseCalc(source: string): CalcRow[] {
	const scope = new Map<string, number>();
	const rows: CalcRow[] = [];
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+?)(?:\s+@\s+(\S+))?\s*$/);
		if (!m) {
			rows.push({ name: line.slice(0, 20), value: null, source: null, formula: null, error: `"${line.slice(0, 40)}" is not "name = value @ source" or "name = formula"` });
			continue;
		}
		const [, name, rhs, src] = m as unknown as [string, string, string, string | undefined];
		const literal = LITERAL.test(rhs);
		const row: CalcRow = { name, value: null, source: literal ? (src ?? null) : null, formula: literal ? null : rhs };
		if (scope.has(name)) row.error = `"${name}" is defined twice`;
		else if (literal) {
			row.value = Number(rhs.replace(/,/g, ""));
			if (!src) row.error = `input "${name}" names no source; add "@ <url>" or "@ assumed"`;
		} else {
			if (src) row.error = `"${name}" is a formula, so it takes no source`;
			try {
				row.value = evaluate(rhs, scope);
			} catch (error) {
				row.error ??= `${name}: ${(error as Error).message}`;
			}
		}
		if (row.value !== null && Number.isFinite(row.value)) scope.set(name, row.value);
		rows.push(row);
	}
	return rows;
}

function numbersIn(text: string): number[] {
	return [...text.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** The printed number is the value rounded to however many decimals the report shows. */
export function printsValue(sentence: string, value: number): boolean {
	const plain = sentence.replace(/(\d),(?=\d{3}\b)/g, "$1");
	for (const m of plain.matchAll(/(?<![\w.])(-?\d+)(?:\.(\d+))?/g)) {
		const decimals = m[2]?.length ?? 0;
		const scale = 10 ** decimals;
		if (Math.abs(Math.round(value * scale) / scale - Number(m[0])) < 1e-9) return true;
	}
	return false;
}

export function checkCalcs(report: string, sourceText: (url: string) => string | undefined, known: (url: string) => boolean): string[] {
	const out: string[] = [];
	const values = new Map<string, number>();
	for (const block of calcBlocks(report)) {
		const label = `calc block ${block.index}`;
		for (const row of parseCalc(block.source)) {
			if (row.error) out.push(`${label}: ${row.error}`);
			if (row.value !== null) values.set(row.name, row.value);
			if (row.source && row.source !== "assumed" && row.value !== null && !row.error) {
				if (!known(row.source)) out.push(`${label}: input "${row.name}" cites ${row.source}, which the tools never returned`);
				else {
					const text = sourceText(row.source);
					if (!text) out.push(`${label}: input "${row.name}" cites ${row.source}, which was never extracted`);
					else if (!numbersIn(text).some((n) => n === row.value)) out.push(`${label}: input "${row.name}" is ${row.value}, which does not appear in ${row.source}`);
				}
			}
		}
	}
	const stripped = calcBlocks(report).reduceRight((acc, b) => acc.slice(0, b.start) + acc.slice(b.end), report);
	for (const sentence of stripped.split(/(?<=[.!?])\s+|\n+/)) {
		for (const tag of sentence.matchAll(/\(derived:\s*([A-Za-z_]\w*)\s*\)/g)) {
			const name = tag[1]!;
			const value = values.get(name);
			const shown = sentence.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\(derived:[^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
			if (value === undefined) out.push(`"${name}" is marked derived but no calc block defines it: ${shown}`);
			else if (!printsValue(shown.replace(/https?:\S+/g, ""), value)) out.push(`the sentence marked derived: ${name} does not print ${Number(value.toFixed(6))}: ${shown}`);
		}
	}
	return out;
}
