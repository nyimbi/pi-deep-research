---
description: "How the diagram-design skill informs the report's diagrams, and what was left out"
---

# diagram-design and the report's diagrams

Question: how does the `diagram-design` Claude skill (installed at `~/.claude/skills/diagram-design`) fit
pi-deep-research?

## What we took

- **The budget.** Nine nodes and twelve arrows per diagram, "past that it is two diagrams". Lint warns at both.
  This replaced my own earlier limit of 15 nodes, which had no source.
- **The remove test and the table test.** Ask whether a table or paragraph does the same job, then merge or drop
  what you can. These went into `references/report-template.md` and the Pi skill's step 7. They cannot be
  checked by a script, so they are guidance, not a gate.
- **A type chooser.** The skill's visual-type guide, cut down to the Mermaid types that exist.
- **Accessible alt text.** Its "figure carries a description" rule, applied to the image link in
  `README.rendered.md`.
- **Its Mermaid importer** as the bridge to a published page (see `docs/evidence-ledger.md`).

## What we left out, and why

- **Calling the skill from the pipeline.** Skills are Claude Code instructions; the Pi extension has no Skill
  tool and the skill needs a model to draw. Not possible, not just inconvenient.
- **Auto-redrawing every report.** A redraw is a model task whose output the ledger gates cannot read, so it
  would put unchecked figures in front of the reader. It stays a manual step.

## Update: aesthetics, tooling and templates adopted

The owner asked for the skill's aesthetics, tooling and templates, so `src/diagram-style.ts` now draws simple
flowcharts itself (see `docs/evidence-ledger.md`, "Editorial style"). Decisions:

- **Draw our own, do not convert Mermaid's output.** The skill names reproducing Mermaid's layout as an
  anti-pattern, and `mmdc` SVG cannot satisfy its connector rules. So a small layered layout draws the diagram
  and declines (falls back to themed Mermaid) when it cannot keep the rules. Covers `flowchart LR` and `TD`.
- **Tokens and page shape copied by value, files not copied.** The palette hex values and the page structure
  are reproduced in code. The skill's templates, references and scripts are not vendored, because its licence
  is not stated in the bundle; the gates call the installed skill at its path and do nothing if it is absent.
- **Its tooling is the gate.** `self_check.py` and `verify-geometry.py` run on every editorial page. Both pass on
  the drawer's output; both fail on a planted diagonal connector and a removed accessible name (tested).
- **Still not covered:** the other 44 diagram types, nested subgraphs, composite states, sequence `par` and the other fragment operators, crossing hops, (dark is done: `diagram-N.dark.*`).

## Measured

`mermaid_extract.py` on the report template's comparison diagram reported 5 drawable nodes, 3 labelled
edges, "budget ok", and named the two subgraphs as collapsible groups. Our lint counts the same 5 nodes.
