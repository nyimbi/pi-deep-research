---
description: "How source_read ranks passages, and how to measure a retrieval change"
---

# Passage retrieval

`source_read` with a `query` ranks the passages of one extracted page. Two signals are fused
with reciprocal rank fusion (k = 60):

- BM25 over the chunk text (`src/retrieval.ts`).
- Dense cosine similarity from a local Ollama embedding model (`src/embed.ts`).

If Ollama or the model is missing, ranking falls back to BM25 and the tool's `details.mode`
reads `lexical` instead of `hybrid`. Nothing needs a GPU or a cloud key.

Embeddings are cached on disk under `<cache.dir>/embeddings/<model>/<sha256 of text>.json`,
so an unchanged chunk is never embedded twice.

## Settings

```json
{ "embeddings": { "enabled": true, "model": "embeddinggemma", "query_prefix": "" } }
```

Pull the model once with `ollama pull embeddinggemma` (621 MB). `EMBEDDINGS=off` disables dense
retrieval and `EMBEDDINGS_MODEL` overrides the model. Models trained with a query instruction
(the Qwen3 family) need it in `query_prefix`, because Ollama applies no template.

## Measuring a change

```bash
npm run retrieval-eval            # default fixture
npm run retrieval-eval -- my.json # your own: {pages:[{id,text}], questions:[{page,query,gold}]}
```

It prints hit rate at 1, 3 and 5 for TF-IDF, BM25 and hybrid, where a hit means the gold
substring sits in a top-k chunk. The run refuses a question whose gold string is not on its page.

Result on `test/fixtures/retrieval/basic.json` (20 questions over 2 pages, 60-word chunks,
`embeddinggemma`):

| ranker | hit@1 | hit@3 | hit@5 |
|---|---|---|---|
| TF-IDF | 0.25 | 0.90 | 0.90 |
| BM25 | 0.65 | 0.85 | 0.90 |
| hybrid | 0.75 | 1.00 | 1.00 |

Treat this as a smoke test, not a benchmark. The questions are hand-written by the same author
as the pages, two pages give only a handful of chunks each, and one miss moves hit@3 by 0.05.
The fixture should grow from archived sources before it is used to choose between models.
