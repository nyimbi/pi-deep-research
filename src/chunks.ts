/** Paragraph-aware chunking and query ranking over extracted text. */

export interface Chunk {
	index: number;
	text: string;
	words: number;
}

const TOKEN = /[\p{L}\p{N}]{2,}/gu;

function tokens(text: string): string[] {
	return text.toLowerCase().match(TOKEN) ?? [];
}

export function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/** First `limit` words of `text`, cut at a whitespace boundary, newlines preserved. */
export function headWords(text: string, limit: number): { text: string; truncated: boolean } {
	let count = 0;
	const pattern = /\S+/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text))) {
		count += 1;
		if (count > limit) return { text: text.slice(0, match.index).trimEnd(), truncated: true };
	}
	return { text, truncated: false };
}

/** Split into chunks of about `target` words, breaking on paragraphs; an oversized paragraph is split by words. */
export function chunkText(content: string, target: number): Chunk[] {
	const pieces: string[] = [];
	for (const paragraph of content.split(/\n\s*\n/)) {
		const trimmed = paragraph.trim();
		if (!trimmed) continue;
		const words = trimmed.split(/\s+/);
		if (words.length <= target) pieces.push(trimmed);
		else for (let i = 0; i < words.length; i += target) pieces.push(words.slice(i, i + target).join(" "));
	}
	const chunks: Chunk[] = [];
	let current: string[] = [];
	let size = 0;
	const flush = () => {
		if (!current.length) return;
		chunks.push({ index: chunks.length, text: current.join("\n\n"), words: size });
		current = [];
		size = 0;
	};
	for (const piece of pieces) {
		const words = wordCount(piece);
		if (size > 0 && size + words > target) flush();
		current.push(piece);
		size += words;
	}
	flush();
	return chunks;
}

/** TF-IDF over the chunks of one document. Returns the top `limit` chunks that match, in document order. */
export function rankChunks(chunks: Chunk[], query: string, limit: number): Chunk[] {
	const terms = [...new Set(tokens(query))];
	if (!terms.length || !chunks.length) return [];
	const counts = chunks.map((chunk) => {
		const map = new Map<string, number>();
		for (const token of tokens(chunk.text)) map.set(token, (map.get(token) ?? 0) + 1);
		return map;
	});
	const scored = chunks.map((chunk, i) => {
		let score = 0;
		for (const term of terms) {
			const tf = counts[i].get(term) ?? 0;
			if (!tf) continue;
			const df = counts.filter((map) => map.has(term)).length;
			score += (1 + Math.log(tf)) * (Math.log((chunks.length + 1) / df) + 1);
		}
		return { chunk, score };
	});
	return scored
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
		.slice(0, limit)
		.map((entry) => entry.chunk)
		.sort((a, b) => a.index - b.index);
}
