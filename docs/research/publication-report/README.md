# Publication-quality reports

Status: page, passages, colophon, PDF, browser check, calc blocks, mechanism and label lint, exemplars done. Charts: one accent for the first series, the rest ink tints (Mermaid theme).
`~/.claude/skills/machine-works/SKILL.md` on 2026-11-23. Nothing is copied from it; the rules are applied to
reports.

## What the doctrine says, and what each rule becomes here

| machine-works rule | Report equivalent | Where |
|---|---|---|
| Verify by rendering | Build `report.html`, open it in headless Chrome at desktop, phone and print size, fail on overflow, broken images or script errors | `src/report-render.ts` |
| One self-contained page | `report.html` works offline: inline CSS and SVG, light and dark skins, print stylesheet; `report.pdf` from the same page | `src/report-html.ts` |
| Real numbers, one source | `calc` blocks: inputs cite ledger sources, results are recomputed, a `(derived: name)` sentence must carry the computed value | `src/calc.ts` |
| The page explains, not only plays | A "How it works" section is expected at standard depth and above; diagram labels must reuse the prose's terms | `src/report-quality.ts` |
| The part doing the work opens up | Every citation opens the passage of the archived source it rests on; passages are also an appendix so print and PDF carry them | `src/report-html.ts` |
| One accent, neat over busy | Same skin tokens as the diagrams; accent only on the focal element; tier badges instead of emoji | `src/report-html.ts` |
| Copy the closest example | Exemplar reports under `examples/reports/` are rendered and checked in tests | `test/report-exemplars.test.ts` |
| Credits | A colophon: question, date, depth, confidence, ledger counts, evidence grade, what was not checked | `src/report-html.ts` |

## Decisions

- **No Markdown dependency.** The package has one runtime dependency (`jiti`). The reports use a small, known
  subset (headings, paragraphs, lists, GFM tables, links, code, quotes, images, fenced blocks), so a purpose-built
  converter with tests is cheaper than a dependency and cannot surprise us with raw HTML pass-through. Raw HTML in
  a report is escaped, never emitted.
- **Chrome for PDF and checks, optional.** The same pattern as `mmdc`: a missing binary is a warning, not a
  failure. Detection order: `report.chrome` setting, `CHROME_PATH`, then the usual macOS and Linux locations.
- **Fonts.** Offline means no web-font link. The CSS names Instrument Serif and Geist first and falls back to
  Georgia and the system sans, so a machine with the fonts installed gets the skill's look and any other machine
  still gets a clean page. Font files are not embedded: their licences are not in this repository.
- **Scripts.** One small inline script opens a citation's passage and drives the diagrams. Without it every link
  still works, the appendix lists every passage, and each diagram is a plain drawing.
- **Interactive diagrams (machine-works doctrine).** An editorial flowchart or state diagram is inlined as live SVG,
  not an `<img>`, in both skins. The drawer tags each part (`g.node`), connector (`data-from`, `data-to`, `data-back`),
  label and the legend, so the page needs no layout knowledge. Hover or focus lights a part and its neighbours and
  dims the rest; a click pins it and shows what the report says about it (the first prose sentence naming it, found
  at build time) plus what it takes from and hands to, read from the connectors; a step control walks the flow in
  dependency order with the single accent on the current part; the buttons, the keyboard (arrows, Escape, + - 0), the
  Ctrl or Cmd wheel and a pinch zoom up to 5x, and a drag pans. A plate of buttons beneath names every part. The
  page crops each drawing to its parts (dropping the legend, which the plate replaces) so text is legible in the
  column. In print the controls go and the light drawing shows. Sequence diagrams and Mermaid fallbacks have no
  parts to point at and stay images. Drag-to-pan and pinch are not covered by a test; the other states are, in
  headless Chrome.

## Rejected

- A headless-browser Markdown pipeline (Pandoc, md-to-pdf): new binaries and no control over the diagram swap.
- Embedding fonts as base64: licence unknown here.
- Running the check page with the final file: the check script is injected into a temporary copy so the
  published page carries no test code.
