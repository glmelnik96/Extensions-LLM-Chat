# Prompt Library Architecture

The prompt library is repository-resident and loaded by the extension at runtime. No remote prompt service.

## Layout

- **prompt-library/README.md** — Purpose and loading.
- **prompt-library/shared/** — Used across all roles.
  - **project-context.md** — Extensions LLM Chat, AE 26.0+, target context, output compatibility, manual apply only.
  - **output-contracts.md** — Generator (expression + ---EXPLANATION--- + ---STRUCTURED--- JSON ---END---), Validator (---REPORT--- JSON ---END---), Repair (expression + ---EXPLANATION--- only).
  - **targeting-rules.md** — Target property must match; Position/Slider/Source Text types; paths.
- **prompt-library/generator/** — Generator pass.
  - **system.md** — Intent, target-fit, style, format, self-check.
  - **grounding-template.md** — Placeholder {{GROUNDING_SNIPPETS}} for knowledge-base snippets.
- **prompt-library/validator/** — Validator passes.
  - **system.md** — Correctness, target match, property suitability, report format.
  - **grounding-template.md** — Placeholder for validator projection snippets.
  - **report-schema.md** — status, issues, fix_instructions, ae_invariants_checked, target_ok, explanation_for_user.
- **prompt-library/repair/** — Repair passes.
  - **system.md** — Patch-oriented, fix recipes, output format.
  - **grounding-template.md** — Placeholder for repair projection snippets.
  - **patching-policy.md** — Do not rewrite unnecessarily; preserve structure; target unchanged.
- **prompt-library/promptsBundle.js** — Runtime bundle. Exposes `window.PIPELINE_PROMPTS` with shared, generator, validator, repair content (strings). Loaded by the panel so no fetch of .md is required.

## How prompts are assembled

1. **Load order** (index.html): `corpusIndex.js` → `promptsBundle.js` → `pipelineAssembly.js` → then systemPrompt.js, aeDocsIndex, … main.js.
2. **pipelineAssembly.js** uses `window.PIPELINE_PROMPTS` and `window.KB_CORPUS_INDEX`:
   - `getGroundingForRole(role)` calls `KB_CORPUS_INDEX.getGroundingForProjection(role)`.
   - `getGeneratorSystemWithGrounding(groundingSnippets)` builds one system string: shared.projectContext + outputContracts + targetingRules + generator.system + generator.groundingTemplate (with {{GROUNDING_SNIPPETS}} replaced by groundingSnippets).
   - Same pattern for validator and repair.
3. **main.js** (buildPipelineGeneratorPayload, buildPipelineValidatorPayload, buildPipelineRepairPayload):
   - If `PIPELINE_ASSEMBLY` and `KB_CORPUS_INDEX` exist: get grounding for the role, get system-with-grounding from assembly, use as the system message.
   - Otherwise: use built-in SYSTEM_PROMPT + PIPELINE_*_INSTRUCTION (safe degradation).

## Degradation

If promptsBundle.js or corpusIndex.js fails to load (e.g. path wrong), `window.PIPELINE_PROMPTS` or `window.KB_CORPUS_INDEX` is undefined. Assembly then returns null and main.js uses the inline fallback prompts. The panel remains usable.
