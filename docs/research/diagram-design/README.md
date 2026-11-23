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
- **Its visual system** (editorial palette, Instrument Serif and Geist, hand-placed orthogonal connectors).
  That is for standalone pages. Our diagrams are Mermaid in a Markdown report, rendered by `mmdc`, and the skill
  names reproducing Mermaid's layout as an anti-pattern. The two do not merge; a page is a separate redraw.
- **Auto-redrawing every report.** A redraw is a model task whose output the ledger gates cannot read, so it
  would put unchecked figures in front of the reader. It stays a manual step.
- **Its geometry verifiers.** They check SVG the skill drew; they say nothing about `mmdc` output.

## Measured

`mermaid_extract.py` on the report template's comparison diagram reported 5 drawable nodes, 3 labelled
edges, "budget ok", and named the two subgraphs as collapsible groups. Our lint counts the same 5 nodes.
