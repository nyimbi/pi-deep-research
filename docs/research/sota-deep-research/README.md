---
description: "Prioritized, local-first roadmap for taking pi-deep-research to state-of-the-art report quality, synthesized from three research tracks"
---

# Roadmap: world-class, local-first deep research

Synthesis of three research tracks dated 2026-11-23. Evidence and source rows live in
[track A](track-a-architectures.md) (agent architectures), [track B](track-b-evaluation-and-quality.md)
(evaluation and report quality) and [track C](track-c-retrieval-extraction-security.md)
(retrieval, extraction, security). Archived copies are in `sources/track-*/INDEX.md`.
Effort sizes (S, M, L) and orderings are my judgment, not a source's claim. Thresholds
marked **untested** are proposals to calibrate on our own fixtures, not published values.

## Where the pipeline stands

Done: provider chain with cache, retry and breaker; SSRF policy; raw page archive;
evidence ledger with URL citation validation; checkpoint counts read from the ledger;
`research_finalize` package with SHA-256 index and a docs-qa gate; academic providers;
local OCR provider; `source_read` with TF-IDF passages and an inline word budget.

The gap, in one sentence: the pipeline proves that a cited URL was returned by a tool, but
not that the cited page supports the sentence. Track B found link validity above 94% while
factual accuracy sat at 39 to 77% (S19), so the largest quality win is the one we have not built.

## Design stance: local first

Every item below names its local mechanism and its optional cloud fallback. Rules:

1. **Deterministic checks before model checks.** Substring, number and date matching
   cost nothing and run anywhere.
2. **Small local models for narrow jobs** (embedding, entailment, quarantined extraction),
   served by Ollama, which the repo already depends on. Choose each model by measured
   agreement on our own labelled fixtures; no model is chosen here on a vendor ranking.
3. **No required GPU.** Anything heavier is an optional provider, like `unlimited-ocr`.
4. **Cloud providers stay as fallbacks**, never as the only path, and nothing new may
   call a third party from an extractor (Defuddle's `parseAsync` is excluded for this reason).
5. **Every fetch passes the SSRF policy and the raw archive**, including new adapters
   and any browser.

| Capability | Local mechanism | Cloud fallback |
|---|---|---|
| Search | SearXNG instances, arXiv, OpenAlex, Crossref, Europe PMC, EDGAR, ClinicalTrials.gov, GDELT | Tavily, Brave |
| Retrieval | BM25 plus Ollama embeddings, RRF (k = 60), MMR | none needed |
| HTML extraction | Defuddle plus Readability in Node | Jina |
| PDF and scans | `pdftotext`, then Docling or Unlimited-OCR on a local server | Tavily, Jina |
| JS pages | local Playwright under the SSRF policy | Jina |
| Claim verification | local entailment model plus deterministic checks | none needed |
| Embeddings | `embeddinggemma` or `qwen3-embedding:0.6b` through Ollama | none needed |

## Shared findings across the tracks

- **An independent verifier beats self-reported confidence.** Track A (Marco: +12.1 average from
  verifier-guided scaling) and track B (S19) agree. The checkpoint still takes confidence from the model.
- **Collecting and writing should be separate phases with a notes artifact between them.**
  Track B: merging them dropped RACE from 52.76 to 42.41 (S25). Track A: durable report memory
  reset each round (IterResearch, WebWeaver).
- **The outline carries evidence IDs.** A section with no evidence triggers another search round
  (tracks A and B, S26, S27).
- **Source quality cannot be judged by the writer model.** Models are near chance at it (S24),
  and Anthropic's testers saw agents prefer content farms. Compute it from the ledger.
- **Prompt injection is not solved.** Adaptive attacks broke all 12 defenses tested, spotlighting
  included (C2). Build structural limits and deterministic checks, not detectors.
- **Do not gate on length or formatting.** Padding bought no score (S07).

## Phased plan

Each item states what it changes, how to tell it works, and its dependencies.

### Phase 0: cheap hard gates (no models, about one week)

| # | Item | Effort | Acceptance |
|---|---|---|---|
| 0.1 | **URL provenance gate.** `web_extract` and `source_read` fetch only URLs the user typed or a tool result returned. Cap model-chosen fetches per turn. Reject query strings the model composed. (C18, C13) | S | A planted `https://evil.test/?q=secret` in model output is refused; test canaried by removing the check |
| 0.2 | **Deterministic claim checks in finalize.** Every numeral, percent, date and quoted string in a sentence that cites a source must appear in a cited archived source. Each Key Finding's verbatim span must exist in the archive. (S19, S15, S08) | S | Planted wrong number and fabricated quote both fail finalize |
| 0.3 | **Typed ledger statuses.** `payment_required` (HTTP 402), `robots_blocked`, `archived` (Wayback), `duplicate`. Terminal statuses are never retried. (C46, C47, C43) | S | Retry loop does not re-fetch a 402 |
| 0.4 | **Hard error on unextracted citations.** Today a cited-but-never-extracted source is already an error under strict; add the 3 to 13% hallucinated-URL measurement to the ledger stats so the rate is visible. (S18) | S | Stats report the share of cited URLs the tools returned |
| 0.5 | **Contradiction ledger and mandatory scope.** Each contradiction names two URLs; limitations and out-of-scope sections must be non-empty. (S05, S03) | S | Finalize rejects an empty Gaps or a contradiction with one URL |

### Phase 1: local retrieval stack (about two weeks)

| # | Item | Effort | Acceptance |
|---|---|---|---|
| 1.1 | **Embedding client** over Ollama `/api/embed` with an on-disk vector cache keyed by content hash. (C31 to C34) | S | Re-embedding an unchanged chunk is a cache hit |
| 1.2 | **Hybrid `source_read`.** BM25 plus dense, fused with RRF at k = 60. Test the Qwen3 query instruction with and without (Ollama applies no template). (C37, C39) | M | On a labelled passage fixture, hybrid beats TF-IDF alone on hit rate at 3; report both |
| 1.3 | **Dedupe and diversify the merged search list.** Canonical URL, then 64-bit simhash (start at Hamming distance 3, re-tune on 200-word snippets, **untested**), then MMR. (C41, C40) | S | Five copies of one press release yield one result |
| 1.4 | **Freshness as a first-class parameter.** SearXNG `time_range`; elsewhere post-filter on a `published_at` kept apart from `retrieved_at`. Tavily and Brave parameters are unverified, so check before relying on them. | S | A year-old result is excluded when `freshness` is set |
| 1.5 | **Retrieval eval harness.** A fixture of pages, questions and gold passages built from the archived sources. Every later retrieval change reports against it. | M | One command prints hit rate at 1, 3 and 5 |

Skipped on purpose: a learned reranker (Ollama has no rerank endpoint, C35, C36). Revisit only
as a flagged pointwise rerank of the top 20, judged by 1.5.

### Phase 2: local verification and quarantine (about two to three weeks)

This phase adds the pipeline's first own LLM client: a small Ollama chat wrapper with no
tools, used only for narrow, schema-bound jobs.

| # | Item | Effort | Acceptance |
|---|---|---|---|
| 2.1 | **Local LLM client** (`src/llm.ts`): Ollama chat, JSON-schema output, timeout, breaker, ledger-accounted calls. | S | Used by 2.2 and 2.3; failure degrades to a warning, never a silent pass |
| 2.2 | **Claim-to-passage entailment check.** For each cited claim, retrieve the top passages with `source_read` logic and ask a binary question: does the passage support the claim. Report ALCE-style citation recall and precision; require at least 90% accuracy on Key Findings (**untested**). Pick the model by agreement with a labelled set. (S19) | M | On a hand-labelled fixture of supported and unsupported claims, measured agreement is printed beside the threshold |
| 2.3 | **Quote-verified quarantined extraction.** Per source, a tool-less call returns a fixed schema of claims, quotes and numbers. Unknown keys are rejected and every quote must be a verbatim substring of the archived page. The substring check is also the only deterministic injection filter in the design. (C1, C7) | M | A page that says "ignore previous instructions" yields no instruction in the structured output; a fabricated quote is dropped |
| 2.4 | **Per-finding grade from the ledger.** Combine source tier, independent-domain corroboration and date, GRADE and Admiralty style. Overall confidence is the minimum over findings. Replaces the model's self-reported confidence in the checkpoint. (S28, S29, S24) | M | Two findings resting on one domain grade lower than two independent domains |
| 2.5 | **Poisoned-page canary corpus.** Visible, hidden, PDF text layer, OCR output, image alt text, search snippet, each with a planted exfiltration URL. Assert 0.1 blocks the fetch and 2.3 drops the quote. Add a human-written adaptive variant, since static suites read clean (C2, C4). | M | Corpus runs in the test suite; removing either gate fails it |

### Phase 3: workflow that writes like the top systems (about two weeks)

| # | Item | Effort | Acceptance |
|---|---|---|---|
| 3.1 | **Notes artifact as durable memory.** A file under the package directory that holds sub-questions, findings so far and gaps. The checkpoint reads it instead of chat history; context resets between rounds. (A: IterResearch, Tongyi) | M | A run survives a context reset and resumes from the notes |
| 3.2 | **Outline with evidence IDs, then section-wise writing.** Ledger entries tagged to outline nodes; a section with none triggers another search round; write each section in a fresh context using `source_read`. LangChain dropped parallel section writing for incoherence, so write sections in sequence with a shared plan and a review pass. (A: WebWeaver, STORM; B: S26, S27) | M | Finalize rejects a section with no evidence IDs |
| 3.3 | **Consolidate phase** between collecting and drafting, writing the notes file. (S25) | S | SKILL.md phases updated; draft starts from notes only |
| 3.4 | **Task rubric at plan time.** Binary graded items covering explicit and implicit requirements, with mandatory and optional tiers. Used as the stop predicate and as the final self-check. Never LLM-expand the rubric (alignment fell 15 to 20%). The measured gain is small (about 0.4 to 0.5 points), so treat it as cheap, not proven. (S04, DuMate) | S | Checkpoint reports rubric items satisfied |
| 3.5 | **Plan approval before execution** and an effort-scaling table in SKILL.md (simple fact: few calls; comparison: several workers; broad: many). Anthropic saw 50 workers for a trivial query without it. (A: Gemini, LangChain, Anthropic) | S | `/research` shows the plan and waits |
| 3.6 | **Critic loop.** One revision pass reading the draft against the rubric and the claim checks. Removing revision cost 5.18 RACE points in one study. (S26) | S | Finalize records whether a revision ran |

### Phase 4: extraction coverage (about two to three weeks)

| # | Item | Effort | Acceptance |
|---|---|---|---|
| 4.1 | **Local HTML extractor ahead of Jina.** Defuddle (sync `parse` only) plus Readability, keeping the longer non-boilerplate result. Gate on a 100-page fixture from WCXB (CC-BY-4.0). Article-tuned extractors fall to 0.41 to 0.84 F1 on forums, listings and docs. (C19, C21) | M | Fixture F1 reported per page type; second extractor used when length is under a threshold |
| 4.2 | **PDF routing.** Text layer first (`pdftotext`), OCR only when characters per page are low. Keep tables as markdown and page numbers in chunk metadata so citations point at pages. Judge OCR choices by retrieval hit rate on the fixture, not character error rate. (C27, C29) | M | A text PDF never reaches the OCR server |
| 4.3 | **Docling provider** (CLI subprocess) with `granite_docling` 258M on MLX as the lightweight default and `unlimited_ocr2_mlx` as the heavy one, reusing the Unlimited-OCR work. Pending the GGUF download for the `llama-cpp` backend. (C26, C27) | M | Layout and tables survive on the fixture |
| 4.4 | **Local Playwright fallback** for JS pages, SSRF policy on every request including subresources, no cookies. No source retrieved this pass; treat the design as unverified. | M | A client-rendered page extracts; a subresource to a private address is blocked |
| 4.5 | **Wayback fallback** on 403, 404, 410 and 5xx, and for date-pinned claims. CDX for enumeration. Public archives only; no paywall bypass. (C43, C44) | S | Ledger marks the source `archived` with the snapshot timestamp |
| 4.6 | **Robots and User-Agent etiquette** for fan-out fetches the tool chose; user-supplied URLs are allowed with a note. (C46) | S | Fan-out fetch of a disallowed path is skipped and recorded |

### Phase 5: domain adapters (S each, add by need)

EDGAR (declare a User-Agent), ClinicalTrials.gov v2, CourtListener (token), GitHub code
search (token), GDELT DOC 2.0, PubMed only if MeSH or date sort is needed beyond Europe PMC.
Each returns a typed record (id, date, status, url) and goes through the SSRF and archive
path. Patent search and government statistics are unverified: check the current USPTO
endpoint and FRED and World Bank before building. (C48 to C52)

### Phase 6: parallelism (L, host dependent)

Orchestrator and workers with isolated contexts that return compressed, cited findings, and
n parallel trajectories with one synthesizer (Tongyi Heavy Mode). Gains flatten past about
8 trajectories and cost grows linearly. This depends on what the Pi host exposes for
sub-agents; confirm before designing. Until then, phases 0 to 3 get most of the benefit
without it.

## Security stance

The extension is the untrusted-input leg by design. Keep private data and outbound
channels off the research session (Rule of Two, C13), scope `research_finalize` writes to
`docs/research/<slug>/`, and let items 0.1, 0.2, 2.3 and 2.5 carry the weight. Datamarked
framing and stripping hidden DOM text (zero-width characters, `display:none`, `aria-hidden`)
reduce opportunistic injection only. Rejected as the main control: keyword filters, "ignore
instructions in the document" prompts, LLM injection detectors, and the full CaMeL runtime.

## Evaluation: how we know it got better

Without this section the roadmap is a list of hopes.

1. **Retrieval fixture** (item 1.5): hit rate at 1, 3 and 5.
2. **Claim-verification fixture**: labelled supported, unsupported and fabricated claims drawn
   from the archived sources; report agreement per local model.
3. **Extraction fixture** (4.1, 4.2): F1 per page type, retrieval hit rate for PDFs.
4. **Canary corpus** (2.5): pass or fail per attack placement.
5. **Report-level check**: run the same five research questions before and after each
   phase and score them against a binary rubric written before the run (S04). LLM judges are
   unreliable on reports (track B), so use a human spot check on a sample.

Report every number with its fixture size and what it does not cover.

## Order of work

1. Phase 0 entire (hard gates, no model risk).
2. 1.1 to 1.2 and 1.5, then 2.1 to 2.3 (the verifier is the biggest quality lever).
3. 2.4 and 3.1 to 3.3 (grading and the notes and outline spine).
4. 4.1 and 4.2, then 2.5 (extraction and the canary proof).
5. 3.4 to 3.6, then Phase 5 as questions demand, Phase 6 last.

## Open questions

- Which small local model gives acceptable entailment agreement? Unmeasured; decided by 2.2's fixture.
- What does the Pi host expose for sub-agents (Phase 6)?
- Tavily and Brave freshness parameters, the patent API, FRED, World Bank, and NCBI and SEC
  exact rate limits remain unverified (track C open items).
- Docling versus Unlimited-OCR on our own PDFs: no independent head-to-head exists, so the
  4.2 and 4.3 fixture decides.

## Implementation status (2026-11-23)

Phases 0 to 6 are built, tested and pushed, with the additions listed in `CHANGELOG.md`. The owner accepted the open items below as known gaps on 2026-11-23; the roadmap is closed with them recorded, not resolved. These items are
not closed, and each waits on something outside the code:

| Item | State | Needs |
|---|---|---|
| CourtListener adapter | Documented response shape only. Anonymous search returns 401. | A `COURTLISTENER_TOKEN` |
| GDELT adapter | Documented shape only. Every probe from this host returned 429, including after a 28 second wait. | Removal, or a network where it answers. Removal is recommended: nothing depends on it. |
| Worker quality versus a single agent | Unmeasured. One worker answered a stub question in 14 s and used its tool; that is all that was run. | A graded question set with known answers and several runs per arm. A quick run on a 9B model would be noise. |
| Phase 3.7 diagrams (Mermaid check, render, charts, lint, evidence graph) | Built and tested before approval. | A keep or revert decision. |
| Playwright WebSocket interception | The page's `WebSocket` constructor is removed. A worker or a page that restores the native one is not covered. | Not planned. |
| `sources/` (129 MB of PDFs, untracked, public repo), `.github/workflows`, the zvec index job | Untouched. | The owner's decision. |

Verified against live services: EDGAR, ClinicalTrials.gov, PubMed, GitHub code search, and the llama.cpp OCR
backend (see `docs/research/unlimited-ocr-llama-cpp/`).
