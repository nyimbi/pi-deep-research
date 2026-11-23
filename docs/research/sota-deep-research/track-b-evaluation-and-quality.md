# Track B: measuring and achieving report quality (as of 2026-11-23)

Source IDs (S01...) refer to `sources/track-b/INDEX.md`. Tags: **V** = verified in the saved source text; **S** = secondary (search-result summary only, not confirmed in source); **I** = my inference, not a source claim.

## 1. What the benchmarks measure

- **RACE (S01, V).** Four fixed dimensions (comprehensiveness, depth/insight, instruction following, readability). A judge generates per-task dimension weights (averaged over T trials) and per-dimension criteria, scores target and a reference report on every criterion, then reports `S_tgt / (S_tgt + S_ref)`. Reason given: isolated scoring gives uniformly high scores. Consequence: absolute scores compress (about 45 to 50) and only ranking and proportions mean anything.
- **FACT (S01, V).** Judge extracts (statement, URL) pairs, dedupes same-fact pairs, fetches the page (Jina), binary support/not-support. Outputs Citation Accuracy and Effective Citations per task. Only checks cited statements.
- **Judge churn (S02, V).** Official RACE judge moved from Gemini-2.5-Pro to GPT-5.5 in May 2026 after a deprecation; FACT judge is GPT-5.4-mini; human inter-annotator agreement baseline is 68.78%. Scores across judges are not comparable. A secondary wiki claim of a July 2026 leader at 55.78 is unverified (S) and not used.
- **DeepResearch Bench II (S03, V).** 132 tasks, 9,430 binary rubrics derived from expert articles, three dimensions: information recall, analysis, presentation. Best total 45.40; Presentation is 74 to 92 for nearly every system while InfoRecall is 23 to 40 and Analysis 36 to 52. Polish is saturated; recall and analysis separate systems. Authors criticise LLM-defined criteria as misaligned with experts.
- **ResearchRubrics (S04, V).** 2,593 expert criteria, six axes (explicit requirements, implicit requirements, synthesis, references, communication, instruction following). Each criterion weighted -5 to 5; +-4/5 mandatory, others optional; negative weights penalise factual errors, irrelevance, verbosity. Best agent 67.7% (ternary). Implicit reasoning plus synthesis are 45 to 50% of failures; agents are good at explicit retrieval and communication (failure rate under 20%).
- **DEER (S05, V).** 7 dimensions, 25 subdimensions, 101 rubric items; five report-quality dimensions (Request Fulfillment incl. Scope, Analytical Soundness, Structural Coherence, Format and Style) plus Information Sufficiency and Information Integrity (Claim Factuality, Citation Support, Reference Support, Reference Quality, Reference Diversity). Claim verification covers uncited claims via "implicit citation back-tracking" (a sentence inherits citations of earlier sentences it semantically depends on). Cost about $0.5 to $1.0 per report. Finding: Scope (what is and is not covered) scored particularly low.
- **HiEviDR-Bench (S06, V).** Five dimensions with progressive gating (evidence, citation, claim, answer). Systems write fluent reports but drop on citation accuracy, claim construction and answer correctness; answer-stage gate pass rates 3.80% to 11.50%.
- **RubricAtlas (S07, V).** Type-level rubrics from expert reports; completeness scored separately from argument validity. Deleting the block answering a question drops its score about 71 to 83% (median); padding with 40% irrelevant or duplicated text gives no detectable gain. Longer reports score higher observationally (about 9 points per log length) but the authors say this is not causal.
- **LiveResearchBench (S10, V for protocols).** DeepEval: checklist coverage, pointwise citation association, rubric-tree citation accuracy, pairwise depth. Depth rubric (0 to 5 each, total 0 to 25): granularity, multi-layered insight, critical evaluation, analytical use of evidence, insight density; explicitly excludes coverage, correctness, formatting, citation, length. A claim that single-agent systems write longer reports with lower citation association is S only.
- **DeepScholar-Bench (S11, V).** Live benchmark (monthly, contamination-resistant); synthesis, retrieval, verifiability; v2 abstract: no system above 31% geometric mean.
- **Fixed-answer search benchmarks.** BrowseComp-Plus (S12, V): fixed 100k-doc corpus, separates retriever from agent (GPT-5 55.9% with BM25, 70.1% with Qwen3-Embedding-8B). BrowseComp-V3 (S13, V): 300 multimodal questions. DeepResearchGym (S14, V): reproducible ClueWeb22/FineWeb search API plus LLM-judge metrics. No clear BrowseComp successor with higher difficulty was found (search result, S). These test retrieval, not reports.
- **Process-level diagnosis.** PING taxonomy (S08, V abstract): Propagation, Intent, Noise-induced, Grounding hallucination across plan-search-summarize. DEFT (S09, V): 14 failure modes; agents fail at evidence integration, verification and reasoning-resilient planning, not task comprehension; "strategic content fabrication" named.

## 2. What separates top systems from average ones

- **Recall and analysis, not prose (S03, V).** See table above; presentation is near ceiling for all. Do not spend gates on formatting.
- **Fluency does not imply grounding (S06, V).** Strong report quality co-exists with failing claim construction.
- **Separate collecting from writing (S25, V).** Merging context builder and writer into one session: RACE 52.76 to 42.41 (insight -16.89, comprehensiveness -11.06). Removing the persistent structured workspace: 52.76 to 48.69. Mechanism claimed: interleaving browsing and drafting causes premature synthesis.
- **Outline as evidence plan, with critic and revision (S26, V; S27, V abstract).** Removing revision: RACE 48.27 to 43.09; removing contraction: 48.27 to 44.72 and citation accuracy 62.20 to 57.79. AgentDisCo uses a critic that critiques the outline and emits refined queries before a separate writer. Deltas are from different backbones and judges; treat as directional.
- **More search lowers citation accuracy (S19, V).** Fact-check accuracy drops about 42% on average as tool calls scale from 2 to 150, while link validity stays above 94% and relevance above 80%. Factual accuracy 39 to 77% across 14 models.
- **Reading pages, not searching, tracked completeness for one agent (S07, V, weak: SE 0.55, observational).** Supports "extract and read" over "search more".
- **Reasoning without search can write better (S05, V).** Think-only models beat think+search on non-information report-quality metrics; extra external information can blur argument structure. Supports the two-stage collect-then-write split.

## 3. Citation faithfulness

- **ALCE (S15, V).** Citation recall per statement = 1 iff cited passages (concatenated) entail the statement (NLI, AIS framework); citation precision flags irrelevant citations, not a minimal set. Authors note NLI misses "partial support", lowering precision vs humans.
- **Link-valid is not claim-valid (S19, V).** See section 2. (S20, V definition) "citations may resolve to real papers yet not support the specific claim."
- **Hallucinated URLs (S18, V).** 3 to 13% of citation URLs have no Wayback record (likely never existed); 5 to 18% non-resolving; deep research agents cite more but hallucinate URLs at higher rates than search-augmented LLMs. A URL-health tool in an agentic loop cut non-resolving URLs 6 to 79x to under 1%. Per-system percentages (78% / 94%) are blog-only (S) and not used.
- **Reference checkers are imperfect (S21, V).** Limited by extraction errors, metadata gaps and database coverage; multi-source checks recommended.
- **Uncited claims go unchecked (S05, V).** DeepResearch Bench FACT and ResearcherBench ignore them; DEER classifies claims A to F and verifies A to C only.
- **Claim extraction (S16, S17, V abstracts).** VeriScore extracts only verifiable claims and runs with open-weight models; decomposition itself introduces variance (DecMetrics). SAFE revision cost figure is S only.
- **Auditability metrics (S20, V; perspective paper, example numbers are illustrative).** Provenance coverage = fraction of claims with complete provenance; provenance soundness = fraction of (claim, source) pairs with entailment above threshold; contradiction transparency = reported conflicts / actual conflicts.
- **Intermediate hallucination propagates (S08, V).** Errors in plan/search/summary stages carry into the report; audit notes, not only the final text.
- **FACT reproducibility (S27, S).** AgentDisCo skips FACT because cited pages 404; this pipeline archives extracted text and raw pages, so it can verify offline.

## 4. Source credibility and evidence grading

- **GRADE (S28, V).** Four certainty levels (high, moderate, low, very low) from five domains: risk of bias, inconsistency, indirectness, imprecision, publication bias; non-randomised evidence upgradable on three more. Designed for outcome-level clinical evidence.
- **Admiralty (S29, S: Wikipedia).** Source reliability A to F rated separately from information credibility 1 to 6 where credibility is corroboration by independent sources; F/6 = cannot be judged.
- **LLMs are poor graders of source quality (S24, V abstract).** Near chance on source discernment, weigh source popularity about twice reliability; newer and larger models do not fix source discernment. Implication: compute grade from ledger facts, do not ask the writer model.
- **Judges miss evidence failures (S23, V abstract).** Best judges under 55% accuracy on controlled-intervention failures, worst on evidence verification.
- **Conflict handling (S03, V; S20, V).** Agents "struggle to form stable viewpoints from conflicting evidence" and over-rely on a small subset of sources; vector aggregation can average away disagreement.

## 5. LLM-as-judge pitfalls for reports

- Binary beats ternary: macro-F1 agreement with humans 0.72 to 0.76 vs about 0.53 to 0.57 (S04, V).
- Do not LLM-augment rubrics: alignment drops 15 to 20%; adding concrete inline examples raises it 3 to 4% (S04, V).
- Task-specific expert guidance lifts judge-human Pearson from 0.63 to 0.73 (inter-human 0.81) (S05, V).
- Style bias (markdown over prose) is the dominant bias, 0.10 to 0.76; position bias at most 0.04; verbosity bias varies by model (Claude Sonnet 4 prefers shorter) (S22, V abstract). Not measured on research reports.
- Judges unreliable on evidence verification (S23, V). Judge model swaps change absolute scores (S02, V). Self-preference results contested (S, search summary only).
- Padding robustness exists for RubricAtlas-style rubric judges (S07, V) but not for holistic judges (I).

## 6. Writing and structure techniques with evidence

- Outline first, outline carries evidence IDs, critic revises outline and emits queries (S26, S27, S25; see section 2).
- Claim-evidence linkage: every claim needs a locatable passage (S20, S15).
- State scope, exclusions, assumptions, limitations (S05: Scope low).
- Quantification transparent and reproducible (S05 Analytical Soundness: formulas, units, stated assumptions).
- Implicit requirements: what a well-informed reader expects unprompted (S04: largest failure bucket).
- Surface contradictions explicitly with named sources (S20, S03).
- Depth checklist for self-review (S10): granularity into causal chains, second-order implications and trade-offs, critique of assumptions, evidence that advances the argument, insight per token.
- Steelmanning is not a measured criterion in any source read; it is covered indirectly by "critical evaluation" (S10) and counter-argument responses (S05 Reasoning). Treat as I, not V.

## 7. Gates for `research_finalize` (deterministic or cheap model)

Existing: rejects cited URLs the tools never returned; warns on cited-but-never-extracted (README, V local). Proposed, in priority order. Thresholds are my starting points (I), to be calibrated on a canary set.

1. **Cited-and-extracted hard gate (det).** Every URL in a Key Finding must be in the ledger with a successful extraction; otherwise error (today a warning). Optional liveness/Wayback check for ledger URLs older than the session. Basis S18, S19.
2. **Number and entity anchoring (det).** For each cited sentence, every numeral, percent, date and quoted string must occur in the archived text of at least one cited source (normalise units, thousands separators, "5 percent"). Cheap, no model. Basis S19 (link valid but fact wrong), S15.
3. **Quote anchoring (det).** Each Key Finding carries a verbatim span of 25 words or fewer; finalize checks the span exists in the archived text (fuzzy ratio at least 0.9). Prevents summary-stage propagation (S08).
4. **Claim-level entailment (cheap model).** Split report into verifiable claims (VeriScore style, S16), retrieve top-k passages from the cited source with `source_read` logic, binary support judge on (claim, passages) only, never the whole report. Report ALCE-style citation recall and precision plus FACT-style citation accuracy and effective citations. Back-track citations to uncited sentences within the same paragraph (S05). Fail if citation accuracy on Key Findings is under 0.9 or any Key Finding is unsupported; warn otherwise. Use a judge from a different family than the writer, pinned and recorded (S02, S22).
5. **Rubric coverage self-audit (cheap model, binary).** At Phase 1 write a task checklist: explicit requirements, implicit requirements ("what would a domain expert expect unprompted"), each tagged mandatory or optional, plus negative items (unsupported claim, off-scope, vendor claim stated as fact). At finalize judge each item binary with the report passage that satisfies it; mandatory miss blocks finalize. Do not auto-expand rubrics with an LLM (S04). Basis S04, S03, S07.
6. **Evidence-grade per Key Finding (det).** Compute, do not self-report: reliability from existing tier; corroboration = number of independent registrable domains with the claim; downgrade for single source, vendor-only origin, no publication date or older than the question's freshness window, source not about the exact entity (indirectness). Emit grade next to each finding; overall confidence from the minimum over Key Findings, not the mean. Basis S28, S29, S24. Needs publication date extraction in the ledger (I).
7. **Contradiction ledger (det + cheap).** Require a Contradictions section where each entry names at least two URLs and a resolution rule; literal "no contradictions found" must list the queries run to look for them. Basis S20, S03.
8. **Source concentration (det).** Warn if one domain supplies over 40% of citations, fewer than three independent domains for a Key Finding, or if more than half of Tier 1/2 claims trace to a single originator. Basis S05 (Reference Diversity), S03.
9. **Scope and limitations (det).** Require non-empty In scope, Out of scope, Assumptions, Limitations sections; check heading presence and minimum content. Basis S05.
10. **Uncited factual sentence rate (det heuristic).** Count sentences with digits or named-entity patterns and no citation (after back-tracking); warn above 15%. Basis S05, S04 (negative rubric "blanket statements without citations").
11. **Do not gate on length or formatting.** Padding showed no gain (S07), style bias exists (S22), presentation is saturated (S03).

## 8. Workflow and template changes

- **SKILL.md:** insert a Phase 3b "consolidate" that writes a notes file (finding, evidence ID, verbatim span, grade) before drafting; writing happens from notes in a fresh context (S25). Checkpoint requires outline sections each listing evidence IDs; a section with none triggers another search round with the critic's query (S26, S27).
- **Verification budget scales with depth (S19):** at `deep` and `exhaustive`, gate 4 is mandatory, not advisory.
- **report-template.md:** add a claim-evidence table (claim, source, verbatim span, grade, corroboration count); add Scope/Out of scope block; add "implicit requirements considered" line; make Contradictions entries require two named sources; replace the free `Confidence: XX%` with the computed per-finding grades plus min rule; add a Depth self-check (S10 five criteria) as a non-scored checklist.

## 9. Rejected or deprioritised

- **Reference-based RACE in finalize:** needs a reference report per task and compresses scores (S01). Use RACE dimensions as writing guidance only.
- **Re-running FACT with Jina refetch:** the ledger already stores extracted text and raw pages; refetching adds page-rot noise (S27, S).
- **Ternary grading:** about 20 points lower human agreement (S04).
- **LLM-generated or LLM-augmented rubrics:** circularity concern and measured degradation (S03, S04).
- **Holistic judge confidence or quality score:** judges under 55% on evidence failures (S23); source discernment near chance (S24).
- **Full GRADE or full Admiralty 6x6:** built for clinical outcomes and human-intelligence sources; adopt the structure (start high, downgrade by named domains; separate source reliability from corroboration), not the full protocol.
- **Provenance graph database (S20):** paper is a perspective with illustrative numbers; the flat ledger plus claim table covers provenance coverage and soundness.
- **BrowseComp, BrowseComp-Plus, BrowseComp-V3, DeepResearchGym as finalize gates:** fixed-answer or sandbox retrieval benchmarks (S12 to S14); keep only as offline regression harnesses for the provider chain.
- **Length thresholds:** see gate 11.

## 10. Open gaps

- No source read measures steelmanning or contradiction sections against human preference; ablation evidence for those template sections is absent.
- Judge-bias numbers (S22) are from MT-Bench-style tasks, not research reports.
- Best-system rankings for late 2026 on the official RACE leaderboard were not verified; judge changed in May 2026 (S02).
- Thresholds in section 7 are untested on this pipeline.
