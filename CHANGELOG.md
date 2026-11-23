---
description: "Changelog for pi-deep-research skill"
---

# Changelog

## [Unreleased]

### Added
- Finalize writes an evidence graph (finding to source domain, with tier and read status) beside the package.
- Pie and xychart-beta charts must match rows of a table in the report.
- Optional mmdc render check at finalize; good diagrams ship as SVG beside their source.
- Browser rendering removes the page `WebSocket` constructor (best effort; tested against a server that records upgrades).
- Mermaid diagrams in reports: finalize checks structure and sourced figures (`src/diagrams.ts`); template section added.
- `unlimited_ocr.backend: llama-cpp` request shape for a patched llama-server. Not verified against a real server: stock llama.cpp cannot load the GGUF.
- `research_workers`: up to 8 sub-questions in parallel, each in an isolated agent session; claims survive only if they cite a URL the ledger holds.
- Domain adapters (EDGAR, ClinicalTrials.gov, PubMed, CourtListener, GitHub code search, GDELT) with typed records, reached through `web_search` with `sources: "domain"`.
- Local Chromium rendering for JavaScript pages (off by default). Every request, subresources included, goes through the fetch-safety policy; no cookies carry over.
- Docling provider (CLI, off by default) for PDFs, office files and images, with a VLM preset option.
- Robots etiquette for fetches the tool chose (user-typed URLs exempt) and a Wayback fallback on 403, 404, 410 and 5xx that records the snapshot timestamp. `safety.respect_robots` and `safety.wayback`.
- Local extraction ahead of network providers: in-process HTML to Markdown (drops hidden text and boilerplate), PDF text layer with page markers, scanned PDFs and client-rendered pages decline to the next provider. Fixture eval in `scripts/html-eval.ts`.
- `research_checkpoint` takes `slug`, reports rubric progress and holds PROCEED while a mandatory item is open.
- `research_notes` tool: durable notes with evidence IDs, a rubric and critic revisions; a run resumes after a context reset. `research_finalize` requires an `[F#]` ID on every Findings line when notes exist.
- SKILL.md: effort scaling, rubric, consolidate and critic phases. Report template lists the sections the finalizer requires.
- Opt-in entailment check in `research_finalize` (local model), with `npm run entailment-eval` for agreement against a labelled fixture.
- Per-finding evidence grade from source tier and independent domains; finalize warns when declared confidence exceeds the weakest finding's cap.
- Poisoned-page canary corpus (7 routes) guarding the fetch and quote gates.
- Local LLM client (`llm.model`) and `source_claims`: quote-verified extraction that drops fabricated quotes, mismatched numbers and instruction-like text. See `docs/verification.md`.
- Search results are freshness-filtered on `publishedDate`, deduplicated by simhash and diversified with MMR.
- Hybrid `source_read`: BM25 plus Ollama embeddings fused with RRF, an on-disk embedding cache, and `npm run retrieval-eval` for hit rate at 1, 3 and 5. See `docs/retrieval.md`.
- Required `## Scope` and `## Contradictions` sections; `## Gaps` must name a real limit.
- Typed ledger URL statuses (`payment_required`, `robots_blocked`, `archived`, `duplicate`); the first two are never refetched. Stats report `citationReturnRate`.
- Deterministic claim checks in `research_finalize`: cited numbers and quotes must appear in the archived source.
- URL provenance gate: `web_extract` refuses URLs the user did not type and no tool returned.
- `research_finalize` runs the vendored docs-qa gate over the report and fails on errors.
- `source_read` tool and an inline word budget for `web_extract`: pages are cut to
  `context.inline_words`, and the rest is read by query or position from the ledger.
- `unlimited-ocr` extract provider: local PDF and image OCR through a Baidu
  Unlimited-OCR-2 server, configured under `unlimited_ocr` in config.json.

## [0.5.0] - 2026-11-23

### Added
- Evidence ledger for every search and extraction, with normalized URLs,
  providers, queries, timestamps, tiers, content hashes and a query log.
- `research_finalize` writes `docs/research/<slug>/`: README, archived sources,
  SHA-256 index, metadata and ledger; citation validation fails on a URL the
  tools never returned.
- Raw page/document capture at extraction time, archived beside the extracted
  Markdown as a second index row (HTML, PDF, JSON, XML or text).
- SearXNG supports an ordered instance list: `base_url` first, then
  `fallback_urls`, so a local instance can front the fleet one.
- Redirects are revalidated hop by hop in raw capture and in the basic
  extraction fallback, closing an SSRF path through a public redirect.
- Native providers: SearXNG, Ollama web search, Jina Reader (extraction),
  arXiv, Semantic Scholar, OpenAlex, Crossref and Europe PMC.
- Retry with exponential backoff and Retry-After, a disk cache for searches and
  extractions, a per-provider circuit breaker, configurable timeouts, and
  per-run search/extract budgets.
- URL safety policy: scheme, credentials, ports, loopback/private IPs and DNS
  resolution checks; extracted text is framed as untrusted data.
- `sources: "academic"` and `mode: "merge"` on `web_search`.
- `references/claude-research-alignment.md`, aligning the workflow with the
  Claude scientific-research skill's paper-lookup and literature-review method.
- Tests: 134, covering the ledger, package writer, providers, retries, cache,
  breaker, URL policy, merge and settings.

### Changed
- `research_checkpoint` computes unique sources from the ledger; the model's
  `total_sources` is reported but not trusted.
- `web_extract` accepts up to five URLs and wraps content in
  `<untrusted_source>`.
- Search providers receive API-side domain and freshness filters where the
  provider supports them.

## [Unreleased]

### Fixed
- `agent-reach` now actually finds `mcporter` / `opencli` in nvm's bin dirs when they aren't on PATH (pi may run without the user's shell PATH). The version-dir filter expected names starting with a digit, but nvm names them `vX.Y.Z`, so every nvm dir was dropped and this fallback never worked.

## [0.4.1] - 2026-09-10

### Fixed
- Xiaohongshu channel passes `--trace=retain-on-failure` to opencli. opencli ≥1.8.6 (extension 1.0.21+) detaches `chrome.debugger` right before `chrome.tabs.update` unless a network capture is active, and Chrome rejects that navigation on Xiaohongshu, every bare search failed with `Navigation rejected` (deterministic on 1.8.6 and 1.8.7). Keeping the capture alive skips the detach: searches succeed again and stop tripping the 15s navigation-idle timeout elsewhere. The flag leaves no artifact on success.

## [0.4.0] - 2026-09-09

### Added
- Built-in support for [agent-reach](https://github.com/Panniantong/Agent-Reach), the popular open-source toolchain that gives agents eyes on the entire internet. Deep research now reaches far beyond plain web search: Exa web search plus Xiaohongshu / Twitter / Reddit community channels, fanned out per query and merged automatically.
- Sits last in the default chain (`tavily,brave,agent-reach`); machines without the toolchain see it skipped cleanly. Login-backed channels ship with throttling guardrails (per-channel budget, failure breaker, result cache).

## [0.3.1] - 2026-08-25

### Added
- Gallery preview assets on [pi.dev/packages](https://pi.dev/packages/pi-deep-research): card image (`docs/card.png`) plus an 8s demo video (`docs/preview.mp4`, autoplays on hover in the package list).

## [0.3.0] - 2026-08-25

Web search is rebuilt as a **hot-pluggable provider chain**: native support stays at Tavily and Brave; any other engine, including local ones like SearXNG or self-hosted Firecrawl, can be added by dropping a `.ts` plugin. Zero-config behavior is unchanged. Local-first direction from #4 by @fank, whose providers live on as example plugins.

### Added
- Custom search providers: drop a `.ts` file into `~/.pi/agent/pi-deep-research/providers/`, list it in the chain, `/reload` (contract and examples in `examples/`).
- Provider chain config: `SEARCH_PROVIDERS` env var or `~/.pi/agent/pi-deep-research/config.json` `{"providers": [...]}`; default `tavily,brave`. Listing only local providers keeps all search traffic off cloud APIs (air-gap friendly).
- Example plugins: `examples/providers/searxng.ts`, `firecrawl.ts`.
- Search failures report what every provider did, e.g. `Attempts: tavily → error (401), brave → empty`.
- Offline unit test suite (`npm test`).

### Changed
- Empty results and errors now fall through to the next provider (may consume Brave quota when Tavily returns nothing).
- Provider calls time out after 30s and fail over instead of hanging.
- `web_extract` prefers providers with extraction capability (e.g. Firecrawl) over the basic HTTP fetch; output names the extractor via `**Provider:**`.
- Batch search reports per-query failures instead of silently returning empty arrays.
- Truncation preserves markdown up to the cut; domain filters apply client-side across all providers with subdomain matching.

### Fixed
- Unknown provider names and malformed `config.json` fail fast at startup with actionable errors.
- Tool results match pi's `AgentToolResult` contract; removed the never-honored `isError` field.

Upgrading from 0.1.6: nothing to do, defaults, tool schemas, and output format are unchanged.

## [0.1.0] - 2026-03-21

### Added
- Initial release
- `web_search` tool (Tavily primary, Brave fallback, batch parallel)
- `web_extract` tool (full page content extraction)
- `research_checkpoint` tool (code-enforced reflection with CONTINUE/PROCEED verdicts)
- 4-phase research workflow: Plan → Search → Reflect → Report
- Multi-hop reasoning patterns: Entity Expansion, Temporal Progression, Conceptual Deepening, Causal Chain
- Source Triangulation for cross-validation
- Human-in-the-Loop plan approval gate
- `/research` slash command with 4 depth levels (quick, standard, deep, exhaustive)
- Strict English keyword matching for depth selection
- Markdown report output with structured sections
- Writing quality anti-patterns guidance
- Confidence scoring with calibration examples
