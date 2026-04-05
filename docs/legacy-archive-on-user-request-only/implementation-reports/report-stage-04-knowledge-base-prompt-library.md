# Stage 4 Implementation Report

This document records the knowledge-layer implementation: local knowledge base, three projections, role-specific prompt library, and grounded prompt assembly. The existing multi-pass pipeline and extension behavior are unchanged.

---

## Summary of the knowledge-layer implementation

- **Local knowledge base**: Repository structure under `knowledge-base/` with `corpus/adobe/` (primary) and `corpus/docsforadobe/` (secondary), plus `projections/` (generator, validator, repair) and `index/corpusIndex.js` that embeds corpus content and exposes `getGroundingForProjection(projectionName)`.
- **Three projections**: All derived from one shared corpus in `corpusIndex.js`. Generator projection: intent, target-fit, patterns, examples. Validator projection: correctness, target mismatch, property suitability. Repair projection: fix recipes, patching patterns.
- **Prompt library**: `prompt-library/shared/` (project-context, output-contracts, targeting-rules), `prompt-library/generator/` (system, grounding-template), `prompt-library/validator/` (system, grounding-template, report-schema), `prompt-library/repair/` (system, grounding-template, patching-policy). Substantial .md content plus `prompt-library/promptsBundle.js` exposing `window.PIPELINE_PROMPTS`.
- **Grounded prompt assembly**: `pipelineAssembly.js` loads after corpus index and prompts bundle; exposes `getGroundingForRole(role)` and `getGeneratorSystemWithGrounding`, `getValidatorSystemWithGrounding`, `getRepairSystemWithGrounding`. main.js uses these in `buildPipelineGeneratorPayload`, `buildPipelineValidatorPayload`, `buildPipelineRepairPayload` when available, with fallback to inline prompts so the panel works if scripts are missing.
- **Result publication**: Unchanged. User still sees only the final result; status line and manual Apply unchanged; session pipeline state remains compact.

---

## New and modified files

| Action  | Path |
|---------|------|
| Updated | **knowledge-base/README.md** — Layout, source priority, three projections. |
| Created | **knowledge-base/corpus/adobe/expression-basics.md** |
| Created | **knowledge-base/corpus/adobe/wiggle-valueAtTime-posterizeTime.md** |
| Created | **knowledge-base/corpus/adobe/sourceText-sourceRectAtTime.md** |
| Created | **knowledge-base/corpus/adobe/property-targeting-constraints.md** |
| Created | **knowledge-base/corpus/docsforadobe/common-patterns.md** |
| Created | **knowledge-base/corpus/docsforadobe/repair-fix-recipes.md** |
| Created | **knowledge-base/projections/generator/topic-map.json** |
| Created | **knowledge-base/projections/validator/topic-map.json** |
| Created | **knowledge-base/projections/repair/topic-map.json** |
| Created | **knowledge-base/index/corpusIndex.js** |
| Created | **knowledge-base/assembly/README.md** |
| Updated | **prompt-library/README.md** — Layout and runtime loading. |
| Created | **prompt-library/shared/project-context.md**, **output-contracts.md**, **targeting-rules.md** |
| Created | **prompt-library/generator/system.md**, **grounding-template.md** |
| Created | **prompt-library/validator/system.md**, **grounding-template.md**, **report-schema.md** |
| Created | **prompt-library/repair/system.md**, **grounding-template.md**, **patching-policy.md** |
| Created | **prompt-library/promptsBundle.js** |
| Created | **pipelineAssembly.js** |
| Modified | **index.html** — Script tags for corpusIndex.js, promptsBundle.js, pipelineAssembly.js. |
| Modified | **main.js** — buildPipelineGeneratorPayload, buildPipelineValidatorPayload, buildPipelineRepairPayload use assembly + KB when available; fallback to inline prompts. |
| Created | **docs/local-knowledge-base.md** |
| Created | **docs/prompt-library-architecture.md** |
| Created | **docs/grounding-policy-by-stage.md** |
| Created | **docs/stage-4-implementation-report.md** |

---

## Corpus and projection structure

- **Corpus**: Single object in `corpusIndex.js` keyed by topic ID. Each topic has `title`, `source` (adobe | docsforadobe), `body`, `snippets` (array of strings). Topics: expression_basics, wiggle_valueAtTime_posterizeTime, sourceText_sourceRectAtTime, property_targeting_constraints, common_patterns, repair_fix_recipes.
- **Projections**: `projections.generator`, `projections.validator`, `projections.repair` are arrays of topic IDs. `getGroundingForProjection(name)` concatenates body and snippets for those IDs in order. Generator and validator share most topics; repair adds repair_fix_recipes and drops sourceText for a narrower set.

---

## Prompt-library structure

- **shared**: projectContext, outputContracts, targetingRules (strings in promptsBundle.js; .md in shared/).
- **generator**: system, groundingTemplate ({{GROUNDING_SNIPPETS}}).
- **validator**: system, groundingTemplate, reportSchema.
- **repair**: system, groundingTemplate, patchingPolicy.

Assembly builds one system string per role: shared blocks + role system + role grounding template with KB snippets injected. main.js uses that as the first system message when assembly is available.

---

## How prompt assembly works in the extension

1. **Load**: index.html loads `knowledge-base/index/corpusIndex.js`, then `prompt-library/promptsBundle.js`, then `pipelineAssembly.js`. So `KB_CORPUS_INDEX` and `PIPELINE_PROMPTS` exist when `PIPELINE_ASSEMBLY` runs.
2. **Per pass** (in main.js):
   - **Generator**: grounding = `PIPELINE_ASSEMBLY.getGroundingForRole('generator')`; systemContent = `PIPELINE_ASSEMBLY.getGeneratorSystemWithGrounding(grounding)`; if null, use SYSTEM_PROMPT + PIPELINE_GENERATOR_INSTRUCTION. Messages = [ systemContent, optional docs context, optional target instruction, user ].
   - **Validator**: grounding = getGroundingForRole('validator'); systemContent = getValidatorSystemWithGrounding(grounding); fallback as above. Messages = [ systemContent, user(expression + target + context) ].
   - **Repair**: grounding = getGroundingForRole('repair'); systemContent = getRepairSystemWithGrounding(grounding); fallback as above. Messages = [ systemContent, user(expression + issues + fix_instructions + target) ].
3. **Caching**: No caching of prompts or grounding in session. Ephemeral: each request gets grounding from KB and system from assembly; no storage in session.pipeline or session.messages beyond what the pipeline already does.

---

## Confirmation: current behavior preserved

- **Panel startup**: Unchanged; script order adds three scripts before existing ones; no change to init or CEP.
- **Multi-pass pipeline**: Same stages (prepare → generate → validate1 → rules → validate2 → repair → finalize). Only the content of the system message for generator/validator/repair is built from the prompt library and KB when available; otherwise fallback.
- **Session persistence**: No new session fields. No prompts or full grounding stored in session.
- **Target selection**: getResolvedTarget(), refreshActiveCompFromHost(), dropdowns unchanged.
- **latestExtractedExpression**: Still set only at finalize when disposition is acceptable; unchanged.
- **Manual Apply**: handleApplyExpression() unchanged; no auto-apply.
- **Host/CEP**: No change to CSInterface or host/index.jsx.
- **Final-only output**: Still one message at finalize; status line and compact pipeline state unchanged.
- **Degradation**: If corpusIndex.js or promptsBundle.js or pipelineAssembly.js is missing or errors, main.js uses inline SYSTEM_PROMPT + PIPELINE_*_INSTRUCTION; panel remains usable.
