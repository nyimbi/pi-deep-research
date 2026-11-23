# Track A: deep research agent architectures (as of 2026-11-23)

Source IDs (S1 to S28) refer to rows in `sources/track-a/INDEX.md`. Tags: **[V]** checked against the local source text, **[A]** abstract or intro only, **[S]** secondary summary, unchecked in primary text.

Current pipeline for reference: one agent, 4-phase SKILL.md, `web_search`/`web_extract`/`source_read`, in-memory evidence ledger, `research_checkpoint` (source counts from ledger, per-sub-question confidence 0 to 100 self-reported by the model, CONTINUE or PROCEED), `research_finalize` (citation URL validation, archive, SHA-256).

## 1. Planning and sub-question decomposition

- Anthropic: lead agent writes a plan, saves it to external memory (context truncates at 200k tokens), then spawns subagents. Each subagent brief needs objective, output format, tool/source guidance, task boundaries; terse briefs caused duplicated work and gaps. [V S1]
- Anthropic effort scaling baked into prompt: simple fact 1 agent and 3-10 tool calls; comparison 2-4 subagents at 10-15 calls each; complex research 10+ subagents. Early failure: 50 subagents for a trivial query. [V S1]
- LangChain scoping: clarify with the user, then compress the chat into a research brief used as the "north star" the supervisor measures against. [V S14]
- Gemini API: `collaborative_planning=true` returns a plan for review, edit, approve via `previous_interaction_id`, before any execution. [V S4]
- STORM: discover perspectives by surveying related articles, then simulate writer/expert conversations per perspective; perspective-guided questions beat "ask 30 questions" direct prompting. Draft outline from parametric knowledge first, then refine with conversations. [V S7]
- LongCat: several planning agents explore sources and refine a `ResearchSpec` with hierarchical section IDs; validators check ID uniqueness, parent links, ordering, required fields; invalid plans are repaired or reverted, unresolved errors stop dispatch. Authors report benefit from combining planning perspectives but "mixed effects" from further refinement. [V S26]
- DuMate: graph-structured plan expanded coarse to fine, revised by reflection, re-planning, backtracking, parallel branching; a failed quality gate prunes the node and replans. [V S25]
- Rejected for us: training-time planning skills (Step-DeepResearch atomic-capability data, Tongyi synthetic data). Needs model training; this package is a harness. [A S23, V S10]

## 2. Orchestrator-worker parallelism and context isolation

- Anthropic: Opus lead plus Sonnet subagents beat single-agent Opus by 90.2% on an internal eval (internal, not reproducible). Parallelism (3-5 subagents, 3+ parallel tool calls each) cut research time by up to 90%. [V S1]
- Cost: agents about 4x chat tokens, multi-agent about 15x. Token usage alone explained 80% of BrowseComp variance (95% with tool calls and model). Read as: more tokens buys score; not evidence that the architecture is free. [V S1]
- LangChain: sub-topic context isolation is the reason multi-agent wins on "compare A vs B vs C"; a single agent's context fills with tool output from unrelated threads. Each sub-agent ends with an LLM call that writes a cited answer, then a cleaning pass, so the supervisor never sees raw scrapes. [V S14]
- Anthropic appendix: subagents write artifacts to a filesystem and pass lightweight references to the lead, avoiding "game of telephone" loss. [V S1]
- Anthropic limitation: synchronous subagent waits; lead cannot steer, subagents cannot coordinate. [V S1]
- DuMate: two-level recursion, each complex sub-task goes to an inner Search Agent with its own planning loop, isolating noisy retrieval. [V S25]
- Tension to record: LangChain removed parallel section writing because reports were disjoint [V S14, S16]; LongCat runs parallel section researchers/writers and fixes coherence with a shared ResearchSpec plus a global review pass producing targeted local edits [V S26]. Both agree that unconstrained parallel writing is the failure; they differ on the fix (write once at the end vs shared spec plus edit pass).
- Rejected: Anthropic-style async subagents. Pi tool calls are synchronous per turn and the paper itself lists async as unsolved. [V S1, A S22]

## 3. Gap-driven iteration and stop criteria

- Gemini deep research: "formulates queries, reads results, identifies knowledge gaps, and searches again". [S S5] Primary API doc confirms background, long-running execution, not the internal loop. [V S4]
- Anthropic: subagents use interleaved thinking after each tool result to assess quality and gaps; lead decides whether to spawn more. Prompt heuristic "start wide, then narrow" because agents default to over-specific queries. [V S1]
- OpenAI: pass rate rises with max tool calls ("the more the model browses and thinks... the better"). [V S2]
- DuMate: stop predicate is tied to a regenerated, task-specific rubric: loop halts when the rubric reports no outstanding gap. Ablation on DeepResearch Bench: overall 58.03 full, 57.61 without rubric at report stage, 57.53 without rubric anywhere. Gain is about 0.4 to 0.5 points; treat as small and unreplicated. [V S25]
- Marco: verifier-guided test-time scaling. The agent itself re-checks answers and keeps reasoning on hard questions; average +12.1 points over the RL baseline across GAIA, xBench-DS, BrowseComp-200 sample, BrowseComp-ZH (Table 5). [V S24]
- Current pipeline gap: checkpoint confidence is model-reported per sub-question; source counts are ledger-derived. No independent verification step feeds the verdict.

## 4. Memory and context management

- IterResearch / WebResearcher: treat research as an MDP. Each round state is only question + evolving report + latest tool exchange; the report is rewritten each round, workspace reset. Authors name "cognitive workspace suffocation" and noise contamination as the failure of append-only context; ablation "Mono-Agent" vs iterative shows the gain. [V S13] Tongyi adopts the same Markovian context management, with trajectory-summary state, and also trains on it. [V S10]
- WebWeaver: memory bank of evidence; outline sections carry citations that index into the bank; writer retrieves only the cited evidence per section. Stated purpose: avoid long-context degradation and citation hallucination. [V S11]
- MiroThinker: interaction depth is a third scaling axis (256K context, up to 600 tool calls); model-level, not harness-level. [V S12]
- Anthropic: summarize completed phases, store essentials externally, spawn fresh contexts with handoffs. [V S1]
- Already present here: ledger plus `source_read` passage retrieval is the memory-bank half of WebWeaver. Missing: a durable evolving report/notes artifact that survives context resets, and per-section evidence maps.

## 5. Source selection and reranking

- Anthropic human testers found agents picked SEO content farms over academic PDFs and personal blogs; fixed by source-quality heuristics in the prompt. [V S1]
- OpenAI states the system can struggle to separate authoritative sources from rumors. [V S2]
- Marco: adversarial uniqueness verification of synthesized questions (training side). [A S24]
- STORM: source bias transfer (internet bias flows into the article) reported by editors. [V S7]
- No system in this set documents a learned source reranker; all rely on prompts or tiered heuristics. This package's credibility tiers are at parity with the state of the art, not behind it. Verification tag: absence claim, [S] by search, not exhaustively checked.

## 6. Reflection and verification

- Anthropic: a separate CitationAgent processes documents and the draft report to attach claims to specific source locations after the research loop ends. [V S1]
- DeepResearch Bench FACT: citation accuracy and effective-citation count are separate. Gemini-2.5 Deep Research had the most effective citations (111.21 avg) but lower accuracy than Perplexity; OpenAI also lower than Perplexity on accuracy. Volume and correctness diverge. [V S20]
- Marco: verifier sub-agent in trajectory synthesis and as test-time verifier. [V S24]
- Per-claim confidence scores with calibration in a report pipeline: [A S27] (abstract only; do not rely on mechanism details).
- OpenAI states weakness in confidence calibration. [V S2]
- Rubric from expert reports as evaluator: DeepResearch Bench II, 9,430 binary rubrics; best systems pass under 50%, weakest on information recall and analysis. [V S21]

## 7. Report writing strategy

- Outline first: STORM (draft outline then refine from conversations; article written section by section retrieving by section headings via embeddings) [V S7]; WebWeaver (dynamic outline with citation links) [V S11].
- WebThinker: report drafting interleaved with research via three tools (draft chapter, check report, edit report). [V S9]
- Write-once-at-end: LangChain one-shot final call over brief plus cleaned findings. [V S14]
- Global review then targeted local revisions rather than full rewrites. [V S26]
- Bench II shows presentation is not where agents lose; recall and analysis are. [V S21] Implication: more effort on gathering and analysis than on prose polish.

## 8. Test-time compute scaling

- Parallel trajectories then synthesis: Tongyi Heavy Mode and WebResearcher run n independent research agents, each returning a compressed report, then one synthesizer. Heavy Mode reports HLE 38.3, BrowseComp-ZH 58.1, BrowseComp 58.3 (authors' numbers). Largest gains n=1 to 8, diminishing past 8, cost linear in n. [V S10, S13]
- Synthesizing from reports, not trajectories, is what makes n agents fit in context. [V S10]
- Verifier-guided continuation: S24 above.
- Anthropic: token budget is the main lever on hard browsing tasks. [V S1]
- OpenAI: accuracy increases with tool-call budget. [V S2]

## 9. RL-trained agents (Search-R1, R1-Searcher, WebThinker DPO, Tongyi, MiroThinker)

- Search-R1: outcome-only reward, retrieved-token masking for stable RL; +41% and +20% average relative over RAG baselines on two model sizes. [V S18]
- R1-Searcher: two-stage outcome RL, no SFT cold start, argues SFT distillation memorizes paths. [V S19]
- Transferable to a harness: none directly. Indirect lesson: rewards were outcome-based and short-answer QA; they say little about long-form report quality. Rejected as a source of mechanism for this package. [V S18, S19]

## 10. Cost and latency

- Perplexity: 2 to 4 minutes target; Gemini and OpenAI: minutes to tens of minutes, background execution. [V S6, S4, S2]
- OpenAI shipped a lighter o4-mini variant to raise query limits (cost control by model tier). [V S2]
- Gemini offers a fast tier and a "Max" tier of the same agent. [V S4]
- Anthropic: tier models (strong lead, cheaper workers), 15x token multiplier, value-of-task gating. [V S1]
- Step-DeepResearch claims cost-effectiveness at 32B with ResearchRubrics 61.42. [A S23]

## 11. Documented failure modes

- Over-spawning (50 subagents), endless search for nonexistent sources, subagents distracting each other, content-farm source bias, duplicated work from vague briefs, game of telephone through the lead. [V S1]
- Disjoint reports from parallel section writing. [V S14, S16]
- Source bias transfer, over-association of unrelated facts. [V S7]
- Context suffocation in append-only trajectories. [V S13]
- Early findings anchoring the narrative and narrowing perspectives explored. [V S26]
- Rumor vs authority confusion, poor calibration, hallucination (system card PersonQA table; the card itself says its rate overstates true hallucination). [V S2, S3]
- Prompt injection from browsed pages; system-level exfiltration mitigations. [V S3] (Already partly handled by `<untrusted_source>` wrapping.)
- Benchmark contamination: answers leaked online forced URL blocking in OpenAI's evals. Applies to any BrowseComp number quoted here. [V S2, S3]
- Gemini architecture claims (single agent vs multi-agent, async task manager) conflict across secondary sources. Not resolved; do not cite. [S]

## 12. Rejected or downgraded

- Perplexity Deep Research: blog gives no mechanism beyond "iteratively searches, reads, reasons, refines plan". [V S6] Used only for latency target.
- Third-party BrowseComp leaderboard rows (garbled, self-reported). Not archived, not used.
- Cross-system benchmark ranking: numbers come from different harnesses, backbones, dates. Only same-table comparisons inside one source are quoted.
- O-Researcher: abstract only; no mechanism read. [A S28]
- Training-based methods: out of scope for a harness (see section 9).

## 13. Ranked transferable mechanisms (for this pipeline)

1. **Evolving report as durable memory with round resets** (S13, S10). Persist a notes/draft artifact updated each round; the checkpoint reads it, not chat history.
2. **Outline with per-section evidence links, section-wise retrieval writing** (S11, S7). Ledger entries tagged to outline nodes; `source_read` called per section.
3. **Orchestrator-worker with isolated contexts and compressed returns** (S1, S14). Subagents return cleaned, cited findings, never raw pages.
4. **Independent verification pass feeding the gate** (S24, S25). Replace self-reported confidence with a verifier check of claim vs ledger passage.
5. **Task-specific rubric generated at plan time, used as stop predicate** (S25). Small measured gain; cheap to try.
6. **Plan approval step before execution** (S4, S14 brief). Cheap, user-visible.
7. **Parallel n trajectories then synthesize from compressed reports, n up to about 8** (S10, S13).
8. **Effort scaling table plus source-quality heuristics** (S1). Explicit subagent and tool-call budgets per depth.
