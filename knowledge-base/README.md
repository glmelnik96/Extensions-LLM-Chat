# Local Knowledge Base

**Scope:** This file describes only the knowledge-base folder (corpus, projections, index). Runtime prompt content lives in **prompt-library/** and **systemPrompt.js**; see docs/local-knowledge-base.md for the full reference.

Repository-resident knowledge base for the multi-pass pipeline. One shared corpus, three role-specific projections. No remote dependency at runtime.

## Source priority

- **Primary**: Adobe Help Center / official After Effects Expression Language Reference.
- **Secondary**: docsforadobe After Effects Expression Reference (mirror and convenience).

## Layout

- **corpus/** — Curated topic content. `adobe/` = primary, `docsforadobe/` = secondary mirror.
- **projections/** — Which corpus topics/snippets feed each role: `generator/`, `validator/`, `repair/`.
- **index/** — Runtime index (`corpusIndex.js`) used by the extension to resolve projections and snippets.
- **assembly/** — Reserved for assembly helpers if needed; main assembly lives in extension `pipelineAssembly.js`.

## Three projections

All three are derived from the same corpus, filtered by role:

- **Generator**: Intent interpretation, target-fit guidance, common AE expression patterns, examples for first draft.
- **Validator**: Correctness and compatibility constraints, target-mismatch detection, property suitability, Source Text caveats, semantic review rules.
- **Repair**: Fix recipes, issue-targeted snippets, patch-oriented transformations, “do not rewrite unnecessarily” guidance.

## Usage

The extension loads `knowledge-base/index/corpusIndex.js` and uses it to get grounding snippets per projection. See **docs/local-knowledge-base.md** and archived stage-grounding policy **docs/legacy-archive-on-user-request-only/multi-pass-copilot-legacy/legacy-grounding-policy-by-pipeline-stage.md**.
