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

It rejects a report that cites a URL the tools never returned, and warns when
a cited source was never extracted. Citation checking is the difference between
a report that looks sourced and one that can be re-read.
