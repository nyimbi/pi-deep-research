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

**Charts.** A `pie` or `xychart-beta` block is a plot of data, so its data must already be in the report. Each
plotted point (`"label" : value`, or the n-th `x-axis` category paired with the n-th `bar`/`line` value) must
match a row of a Markdown table whose cells hold the label and the number. A chart with no table, a value
with no category, a value in another row or a slice no row backs fails a strict run. The table's own
figures are covered by the claim check when the row cites a source, so a chart needs no `%% source:` line.
A table with no citation backs the chart without the figures being checked against any page.

**Evidence graph.** When a Findings line cites sources, finalize writes `diagrams/evidence-graph.mmd` (and an SVG
when rendering is on): one node per cited finding, one per registrable domain, and an edge labelled with the
source's tier and whether it was read. It is generated from the ledger, never typed, and it is not appended
to the report, so the README stays the text the author wrote.

**Lint (warnings only).** `lintDiagrams` warns when a diagram has no caption sentence of five words or more
directly before or after it, when most flowchart arrows carry no label (`-->|text|`, `-- text -->`,
`==>|text|` and `-. text .->` all count), when a sequence message has no text, and when a `## Comparison`
section has no diagram, when a flowchart has more than 9 nodes or 12 arrows (the diagram-design skill's budget), and when a diagram repeats an earlier one
verbatim. These are style, so they never fail a strict run. The template's comparison
skeleton (before and after, the added edges styled) is tested to stay valid.

When diagrams render, the package also gets `README.rendered.md`: the report with an image link to
`diagrams/diagram-N.svg` after each rendered block, for viewers that do not draw Mermaid. `README.md` stays the
report that the gates checked.
The image alt text is the diagram's caption sentence.

**Editorial style (diagram-design).** `diagrams.style: editorial` (the default; `DIAGRAM_STYLE=mermaid` turns it
off) draws each simple flowchart itself in the `diagram-design` skill's style: its paper, ink and accent tokens,
6px-radius boxes with no shadows, one focal node (the hub, when it has three or more connections), right-angle
connectors with r=8 elbows, one port per connector, all-caps arrow labels on a mask 6 to 10px above the line, a
legend strip, and an accessible `<title>` and `<desc>` taken from the caption sentence. Each drawn diagram is
written as `diagrams/diagram-N.svg` and a standalone page `diagrams/diagram-N.html` in the skill's page shape.

It draws three Mermaid types, and what it can draw correctly of each:

- **Flowcharts** (`flowchart` or `graph`, `LR` or `TD`): one level of subgraphs drawn as titled frames, with
  arrows between frames allowed (each subgraph gets its own band, so frames never meet); cycles, drawn as a
  back arrow in a lane beside the nodes; `linkStyle` arrows with a stroke take the accent (at most 2).
- **State diagrams** (`stateDiagram` or `stateDiagram-v2`, optional `direction LR`): states, `[*]` start and end
  markers, labelled transitions and loops. Composite states, forks, choices, notes and descriptions are refused.
- **Sequence diagrams**: up to 5 participants and 12 messages. `->>` is a call (solid), `-->>` a return (dashed,
  filled head), `-)` and `--)` async (dashed, open head). `alt` (two regions at most, with a dashed divider),
  `opt` and `loop` are drawn as frames over only the lifelines that speak inside them, with the guard under the
  tab. The skill's limits apply: one fragment, or two if both are single-region `opt` or `loop`, and no nesting.
  `par`, `critical`, `break`, `ref`, notes, activations and self-messages are refused.

Common limits: up to 9 nodes and 12 arrows, flowchart and state labels of 14 characters or fewer (28 in a sequence
diagram), and a route for every arrow that avoids every other box. Anything else is drawn by Mermaid, themed with the
same tokens, and finalize warns with the reason, for example "is drawn by Mermaid, not in the editorial style: label
over 14 characters". Shorten the label and it is drawn in style on the next run.

Every editorial diagram is also drawn in the skill's dark skin (`diagrams.dark`, default true): `diagram-N.dark.svg`
and `diagram-N.dark.html`, same layout with the dark tokens (paper `#2d3142`, ink `#f5f5f5`, accent `#f08a59`).
`README.rendered.md` embeds both with a `<picture>` element, so a viewer picks by its colour scheme.

When the skill is installed (`diagrams.design_skill_dir`, default `~/.claude/skills/diagram-design`), finalize also
runs its `self_check.py` (accessible-SVG and page contract) and `verify-geometry.py` (the six connector rules) on
every editorial page and reports findings as warnings. The skill itself is not copied into this repository.

**Publishing a diagram as a page.** The editorial pages above are already standalone. For a diagram the drawer
declines, or for any of the skill's other 44 types, the `diagram-design` skill itself redraws it as an editorial,
self-contained HTML page with inline SVG; it does not convert Mermaid. It is a Claude Code skill, so it runs after finalize,
not inside the Pi extension. Run `python3 ~/.claude/skills/diagram-design/scripts/mermaid_extract.py <package>/README.md`
to get each diagram's nodes, edges and budget flags, redraw from that, and carry the `%% source:` URL into the
drawing's `<desc>`. The redrawn page is not checked by the ledger gates; only the Mermaid it came from is, so a
figure must not appear in the page that is not in the checked source. See `docs/research/diagram-design/`.

**Render check.** On by default (`DIAGRAM_RENDER=off` or `diagrams.render: false` disables it), finalize also renders each block with
`mmdc` (`src/diagram-render.ts`). A parse error fails a strict run with mmdc's own message, and each good
block ships as `diagrams/diagram-N.mmd` and `.svg` in the package, so the report reads without a Mermaid
renderer. mmdc needs a headless Chromium, so when it is not installed the run warns ("mmdc is not installed") instead of failing, and the diagrams are checked structurally only. Settings `diagrams.{render, mmdc, timeout_ms}`.

## Offline report page

Finalize writes `report.html` beside the README: one file, no network. It has a contents list, light and dark
skins (the same tokens as the diagrams), a print stylesheet, every editorial diagram inlined in both skins, and a
colophon with the question, depth, confidence, evidence grade, source counts and what was not checked.

Every citation to an archived source opens the passage it rests on: the paragraph of the archived text that shares
the most words with the citing sentence, with the source's tier, URL and archive file. The same passages sit in a
"Passages" section, so print and PDF carry them. A source with no matching paragraph says so instead of showing
an arbitrary one. Raw HTML in the report is escaped; unsafe link schemes become `#`.

When Chrome or Chromium is found (`report.chrome`, `CHROME_PATH`, or the usual install paths), finalize also opens
the page at 1280 and 390 px and warns on sideways overflow, an image that did not load, or a script error, then
prints `report.pdf` from the same file. No browser means no checks and no PDF, with no warning beyond the missing
file. Settings: `report.html` (default true), `report.check` (default true), `report.chrome`.

### Calc blocks and publication checks

A fenced `calc` block keeps a report's arithmetic in one place:

```text
tail_ms = 1830 @ https://example.org/latency-study
budget_ms = 2000 @ assumed
headroom_pct = (budget_ms - tail_ms) / budget_ms * 100
```

Inputs carry `@ <url>` or `@ assumed`. A URL input must be a source the tools returned, and its number must appear
in the archived text. Formulas use earlier names with `+ - * /` and parentheses, evaluated by a small parser (no
`eval`). A sentence marked `(derived: headroom_pct)` must print the value, rounded to the decimals it shows.
Problems are errors in a strict run and warnings otherwise. The page draws the block as a table with each
source linked, and shows the tag as a small "calc" marker.

Two warnings ask for better writing: a deep or exhaustive report with no "How it works" section of three
explanatory paragraphs, and a diagram label whose words the prose never uses.

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
| `github-code` | `GITHUB_TOKEN` | blob SHA | live (one read-only query, 2026-11-23; the test fixture is the documented shape) |

A plain-text 200 is reported as a rate limit, not an empty result. CourtListener and GDELT were removed on 2026-11-23: the first needs a token nobody had, the second answered 429 on every probe. Patent
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

**Verified.** Stock llama.cpp cannot load the GGUF (`unknown model architecture: 'unlimited-ocr2'`), so
`scripts/build-llama-ocr.sh` builds `b11913` with a reviewed copy of the community patch (archived under
`docs/research/unlimited-ocr-llama-cpp/`, with the review notes and the fact that its hash differs from the one on
the model card). Serve it with `-np 1`. On four text PDFs the cleaned output scores token F1 0.984 to 0.998
against `pdftotext` at about 13 s per page; that says nothing about scans. The server's `<BLOCK>type[box]<FORK>`
layout tags are turned into headings and text by `cleanOcrOutput`, and the backend sends `cache_prompt: false`
because a full prompt-cache hit returns an empty completion.
