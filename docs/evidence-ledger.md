---
description: "How the evidence ledger, raw page archive and research_finalize package work"
---

# Evidence ledger and finalize

The extension keeps a per-session ledger of every search result and extraction:
normalized URL, title, provider, query, timestamp, tier, and extracted content
with a content hash. `research_checkpoint` reads the ledger, so the source count
in a verdict is measured, not self-reported.

`research_finalize` writes the durable package and is a hard gate:

```
docs/research/<slug>/
  README.md              report with Question, Findings, Decisions,
                         Rejected options, Confidence, Gaps, Scope,
                         Contradictions, Sources
  report.md              the report as written, when it differs
  sources/INDEX.md       URL, access date, local file, SHA-256, tier
  sources/<file>.md      archived extracted text
  sources/<file>.html    raw page copy (or .pdf), a second index row
  research-package.json  metadata, citation sets, stats
  ledger.json            every query attempt, source and failure
```

A relative `archive.root` resolves against the enclosing git repository root,
so running research from `app/server/` still writes to `docs/research/` at the
top of that repo. An absolute path is used as written.

Every extraction also captures the raw page or document under the cache
directory, subject to the same URL policy and size cap. Finalization copies it
into the package beside the extracted text, so a reader has both the readable
version and the artefact it came from. A page that blocks capture is reported;
the extracted text is still archived.

Three sections are checked for content. `## Gaps` must name a real limit (a bare "None" fails),
`## Scope` must state what is in and out of scope, and every `## Contradictions` entry must cite
at least two distinct sources, or the section must say "None found after checking N sources."

Finalization also verifies claims deterministically (`src/claim-check.ts`). Within a cited
bullet, table row or sentence, every percentage, decimal and number of three or more digits,
and every quoted passage of three or more words, must appear in a cited archived source.
Small bare integers are ignored, a sentence marked `(derived)` is skipped, and a source
that was never extracted is skipped (it already fails the extraction check). A source that
spells a number out in words reads as a mismatch.

The report must also pass the vendored docs-qa gate (`scripts/docs_qa.py`, a copy of the
global `~/.claude/scripts/docs_qa.py`): an error such as an em dash fails finalization,
and `strict: false` downgrades it to a warning. If Python 3 is missing the gate fails
closed rather than passing silently.

It rejects a report that cites a URL the tools never returned, and warns when
a cited source was never extracted. Citation checking is the difference between
a report that looks sourced and one that can be re-read.

## Terminal statuses and citation rate

The ledger records a typed status per URL: `payment_required` (HTTP 402), `robots_blocked`,
`archived` and `duplicate`. The first two are terminal: `web_extract` will not fetch that URL
again in the session, and the retry layer never retries a 402. `ledger.json` carries the
statuses, and the package stats report `citationReturnRate`, the share of cited URLs that a
tool returned (1 means none were invented).

## Diagrams

`src/diagrams.ts` checks every fenced `mermaid` block in the report. The structural check needs a
known diagram type and balanced brackets and quotes (no renderer is involved, so a diagram can still
fail to render for reasons this does not see; `mmdc` renders the same text). Figures in a block's
labels go through the same number check as a sentence, against the URLs named in `%% source:` comment
lines, which must be in the ledger. A block with figures and no source fails. Strict runs fail on
these; `strict: false` warns.

## Notes, evidence IDs and resume

`research_notes` keeps `notes.json` and `notes.md` beside the package, plus a ledger snapshot,
so a run survives a context reset: `op: read` restores the notes and, when the in-memory ledger
is empty, the ledger too. A finding can only cite URLs the ledger already holds, and returns an
ID such as `F3`. When notes exist, `research_finalize` fails strict runs on a Findings line with
no ID or an unknown ID, and on an unsatisfied mandatory rubric item. It warns about an optional
rubric item, a sub-question with no finding in the report, and a run with no recorded critic
revision. The rubric is written by the agent from the user's request; nothing expands it.

## Local extraction

`web_extract` tries the in-process `local` provider before any network extractor
(`src/native/local-extract.ts`). It fetches under the SSRF policy, archives the raw bytes, then:

- **HTML:** `src/html-extract.ts` parses the page, drops scripts, navigation, footers, cookie
  banners and hidden elements (`hidden`, `aria-hidden`, `display:none`), picks the main
  content by text density, and writes Markdown with tables and resolved links. Dropping hidden
  text also removes a common prompt-injection hiding place.
- **PDF:** the text layer is read with `pdftotext`, with a `[page N]` marker per page so a
  citation can point at a page. A PDF averaging fewer than `min_chars_per_page` (200)
  non-space characters per page is treated as scanned and declined, so only scans reach OCR.
- A page yielding fewer than `min_words` (80) is declined as likely client-rendered, and the
  chain falls through to the next provider. A 402 stops the chain.

Measure it with `node scripts/html-eval.ts`: mean token F1 per page type against hand-written
gold text, next to the old regex strip. On the 8-page fixture the local extractor scores 0.88
to 1.00 against 0.78 to 0.86. The fixture is small and self-authored, so read it as a
regression test, not a benchmark. Settings: `local_extract.{enabled, min_words,
min_chars_per_page, pdftotext, max_pages}`; `LOCAL_EXTRACT=off` disables it.

## Robots and the Wayback fallback

**Robots.** A URL the user typed is fetched as asked. Any other fetch (a search result or a page
link) first reads the origin's `robots.txt` (`src/robots.ts`, RFC 9309: the group naming
`PiDeepResearch` beats `*`, longest rule wins, Allow wins a tie, `*` and `$` supported). A
disallowed page is skipped and recorded as `robots_blocked`, which is terminal for the session.
A missing `robots.txt` allows; a 5xx or an unreachable-by-status file denies, as the RFC says;
a network error allows, so one flaky host cannot block a page. Set `safety.respect_robots`
to `false` to turn this off.

**Wayback.** When a fetch ends in HTTP 403, 404, 410 or 5xx, `web_extract` asks the archive for the
closest public snapshot (`src/wayback.ts`) and extracts that. The text is stored under the
original URL, which the report cites, and the ledger status is `archived` with the snapshot
timestamp. 401 and 402 are never routed around. The snapshot URL must be on `web.archive.org`.
Set `safety.wayback` to `false` to turn this off. CDX enumeration and date-pinned lookups
are not built.

## Docling

`src/native/docling.ts` converts PDFs, office files and images to Markdown with tables through the
`docling` CLI. It sits after the local text layer in the extract chain, so a text PDF never
reaches it, and it is off by default (`docling.enabled` or `DOCLING=on`) because the first run
downloads models. The standard pipeline runs with `--device cpu`: on this Mac the MPS backend
fails with a float64 error, and a 1-page PDF took about 6 s on CPU. Set `docling.vlm_model`
(for example `granite_docling`) to use a VLM preset instead. It declines web pages without
running anything. The Unlimited-OCR provider remains the heavy option for scans.

## Browser rendering

`src/native/browser.ts` renders JavaScript pages in a local headless Chromium through Python
Playwright (`scripts/render.py`), then runs the result through the same HTML extractor. It is off
by default (`browser.enabled` or `BROWSER_RENDER=on`) and sits after the local providers, so it
runs only when plain extraction declined the page.

The script sends every request the page makes, subresources and redirects included, to the
Node process, which answers with the same fetch-safety policy as every other fetch
(`assertFetchableUrlResolved`). A refused request is aborted before it leaves the browser, and
the count is logged. Each run uses a fresh context: no cookies or storage carried between
pages, no service workers, no downloads. WebSockets are not intercepted by Playwright's request routing, and `route_web_socket` crashed the installed driver, so the page's `WebSocket` constructor is removed in every page and frame. That is best effort: a worker, or a page that recovers the native constructor, is not covered, so run it on hosts where outbound traffic is otherwise restricted if that matters.

## Domain adapters

`src/native/domain.ts` adds registry searches that return a typed `record` (kind, id, date,
status) next to the usual title, URL and snippet. Reach them with `web_search` and
`sources: "domain"`, which queries every configured one in parallel; `pubmed` also joins the
`academic` set. Fetched pages still go through the provenance gate, SSRF policy, robots check and
archive, because a result URL is only a lead until `web_extract` reads it.

| Adapter | Needs | Record | Verified |
|---|---|---|---|
| `edgar` | `SEC_USER_AGENT` (SEC requires contact details in the header) | accession number, filing date, form | live response captured in `test/fixtures/domain/edgar.live.json` |
| `clinicaltrials` | nothing | NCT id, last update, overall status | live |
| `pubmed` | nothing; `NCBI_API_KEY` optional | PMID, sort date, publication type | live |
| `courtlistener` | `COURTLISTENER_TOKEN` | cluster id, date filed, status | documented shape only |
| `github-code` | `GITHUB_TOKEN` | blob SHA | documented shape only |
| `gdelt` | nothing; one request per 5 seconds | URL, first-seen date | documented shape only; this host was rate limited when probed |

A plain-text 200 (GDELT's rate limit) is reported as a rate limit, not an empty result. Patent
search and government statistics are not built; check the current USPTO, FRED and World Bank
endpoints first.

## Parallel workers

The Pi host has no built-in sub-agents, but its SDK can create isolated sessions, so
`research_workers` runs up to 8 sub-questions at once (`src/workers.ts`, `src/worker-session.ts`).
Each worker is a fresh in-memory session on the current model with only `web_search`,
`web_extract`, `source_read` and `source_claims`, no extensions (so no recursion), skills or context
files, and a fixed prompt. Workers share the ledger, provenance state, robots checks and budget with
the orchestrator, so every fetch is governed as before.

A worker returns lines of the form `claim [source: URL]` plus optional `Gap:` lines. The orchestrator
parses them and keeps a claim only if one of its URLs is in the ledger; a claim with an unknown URL is
dropped and counted, and a claim that cites only a search snippet is labelled as such. The output is
a set of leads: the main agent still reads, grades and records findings with `research_notes`. One
worker failing or timing out does not lose the others. Settings: `workers.enabled`,
`workers.concurrency` (default 2, because local models share one machine) and `workers.timeout_ms`.

Measured: one worker on `mimo-v2.6:9b` with a stub search tool answered in 14 s and used the tool.
Whether parallel workers beat a single agent on answer quality is not measured here, so the
gain the roadmap cites (Tongyi Heavy Mode) is unconfirmed for this pipeline. The cap of 8 follows
the reported flattening past that point.

## Unlimited-OCR on llama.cpp

`unlimited_ocr.backend` (or `UOCR_BACKEND`) is `sglang` by default. `llama-cpp` sends the page images
alone, because the GGUF's embedded chat template adds `<PAGE>` before each image and the trained
instruction, and omits the SGLang-only fields (`images_config`, logit processor). A unit test pins
that request shape.

**Not verified end to end.** The GGUF download (Q6_K plus the mmproj, 3.3 GB) is complete, but both
stock llama.cpp builds on this machine (Homebrew build 12359, Unsloth build 12631) refuse it with
`unknown model architecture: 'unlimited-ocr2'`. The model card says the files need llama.cpp build
b11913 plus a community patch from a third-party repository. That patch is unreviewed code, so it was
not built or run here. Until someone does, treat the `llama-cpp` backend and the layout headers its
output may carry as untested.

