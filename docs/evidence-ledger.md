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
                         Rejected options, Confidence, Gaps, Sources
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

