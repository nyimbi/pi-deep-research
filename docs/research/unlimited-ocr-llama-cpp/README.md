---
description: "Review, build and measurements for running Unlimited-OCR-2 on a patched llama.cpp"
---

# Unlimited-OCR-2 on llama.cpp

Question: can the GGUF (`AtomicChat/Unlimited-OCR-2-GGUF`, Q6_K plus the F16 mmproj) run locally
without SGLang? Mainline llama.cpp cannot: both the Homebrew build 12359 and the Unsloth build 12631
stop with `unknown model architecture: 'unlimited-ocr2'`.

## The patch

The model card names a community patch from `RX5950XT/Unlimited-OCR-2-GGUF` for llama.cpp `b11913`
(commit `7aca0d2`). A copy of the file that was reviewed and built is archived here as
`unlimited-ocr2.patch` (sha256 `f2c337b5...0f41`, 1,250 lines, 18 files).

**The hash differs from the card.** The card quotes `dcdac02ede443987...`; the file served on
2026-11-23 hashes to `f2c337b5...`. The repository was last modified on 2026-11-01, so the file has likely
changed since the card was written, but that is an inference. The reviewed file is the one in this
directory, and `scripts/build-llama-ocr.sh` refuses any other.

**Review result.** The patch adds a model architecture (`src/models/unlimitedocr2.cpp`, ggml graph code),
its hyperparameters and tensor names, a KV-cache accessor, Python conversion mappings, small mtmd
changes (a page-boundary token rule for this architecture and a "base mode" for small token budgets, plus
Vulkan-friendly reshapes in the SAM encoder), and an `imatrix` mode that reads operator-supplied prompt
files. I searched the added lines for process execution, sockets, URLs, environment access and writes and
found none; the only file reads are in the `imatrix` tool, which is not built into `llama-server`. This is
a read of the diff, not a proof: the model math was not audited, only its behaviour measured below.

## Build

`scripts/build-llama-ocr.sh` fetches tag `b11913`, applies the patch and builds `llama-server` with
Metal (about 6 minutes on an M-series Mac). Two build facts: a shallow clone has build number 1, which
makes the UI-asset step download a nonexistent bundle and fail, so the script passes
`-DLLAMA_BUILD_UI=OFF -DLLAMA_BUILD_NUMBER=11913`; and the patched model supports one sequence, so the
server needs `-np 1`.

## Measured

Same machine, Q6_K, 150 dpi JPEG pages, `unlimited_ocr.backend: llama-cpp`, 2 pages per request.
Score: token F1 of the cleaned OCR text against `pdftotext` for the same pages.

| PDF (first 2 pages) | Seconds | Precision | Recall | F1 |
|---|---|---|---|---|
| information-discernment | 27 | 0.997 | 0.999 | 0.998 |
| agentdisco | 25 | 0.996 | 0.996 | 0.996 |
| deer | 31 | 0.990 | 0.977 | 0.984 |
| dumate-deepresearch | 24 | 0.988 | 0.995 | 0.991 |

These four have text layers, so this measures how faithfully the model reads clean typeset pages. It
says nothing about scans, handwriting or dense tables, which is where OCR earns its keep.

## What the server does that the card does not say

- **Output format.** The text comes back as `<PAGE>` then lines of `<BLOCK>type[x1, y1, x2, y2]<FORK>text`.
  With several pages in one request a title carries a depth (`title<LEVEL2>`) and `<MERGE>` marks a
  paragraph continuing across a page break. `cleanOcrOutput` turns titles into headings at that depth and
  drops headers, footers and page numbers. Before the cleaner handled the tags, F1 on one page was
  0.943; after, 0.988.
- **Prompt-cache bug.** A request whose whole prompt matches the server's cached prompt returns an empty
  completion (0 characters, 1 token). Reproduced with an identical repeated request; `cache_prompt: false`
  returns the page. The `llama-cpp` backend always sends it.
- **No prompt needed.** The embedded chat template adds `<PAGE>` and the instruction when the message has
  no text, so the backend sends images only.

## Not measured

Scanned or photographed pages, tables and formulas, the other quantisations, speed against the SGLang
build, and anything past two pages per request.
