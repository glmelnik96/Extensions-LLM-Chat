# Grounding Policy by Stage

How the local knowledge base and prompt library are used at each pipeline stage. All grounding is local (no online doc fetch for the knowledge layer).

## Generate

- **Projection**: generator.
- **Content**: `KB_CORPUS_INDEX.getGroundingForProjection('generator')` returns topics: expression_basics, wiggle_valueAtTime_posterizeTime, sourceText_sourceRectAtTime, property_targeting_constraints, common_patterns. Bodies and snippets are concatenated into one string.
- **Prompt assembly**: Generator system prompt (from prompt-library) + grounding template with that string injected. Optional: existing docs context from aeDocsRetrieval (BUILD_DOCS_CONTEXT_MESSAGE) is still added as a separate system message when available. Target instruction (comp, layer, property) added when targetSnapshot exists.
- **Goal**: Broader grounding for intent, target-fit, and common patterns so the first draft is valid and target-appropriate.

## Validate-1

- **Projection**: validator.
- **Content**: `getGroundingForProjection('validator')`: expression_basics, property_targeting_constraints, sourceText_sourceRectAtTime, wiggle_valueAtTime_posterizeTime, common_patterns. Focus on correctness, target mismatch, property suitability.
- **Prompt assembly**: Validator system prompt + validator grounding template with validator snippets. User message: expression + target context.
- **Goal**: Issue detection and structured reporting (status, issues, fix_instructions, target_ok).

## Rules

- **No grounding**: Rules stage is deterministic code (runDeterministicRules). No prompt or knowledge-base content.

## Validate-2

- **Projection**: validator (same).
- **Content**: Same validator projection. Validator prompt also receives prior context (report1 status and fix_instructions) in the user message.
- **Goal**: Stronger convergence check with prior validation context.

## Repair-1 / Repair-2

- **Projection**: repair only.
- **Content**: `getGroundingForProjection('repair')`: repair_fix_recipes, wiggle_valueAtTime_posterizeTime, property_targeting_constraints, common_patterns. Focused on fix recipes and minimal patching.
- **Prompt assembly**: Repair system prompt + repair grounding template with repair snippets. User message: current expression + issues + fix_instructions + target.
- **Goal**: Narrow, issue-targeted fixes; do not rewrite from scratch.

## Summary

| Stage     | Projection | Purpose                                      |
|----------|------------|----------------------------------------------|
| Generate | generator  | Intent, target-fit, patterns, first draft    |
| Validate-1 | validator | Correctness, target_ok, issues, fix_instructions |
| Rules    | —          | Code-only                                    |
| Validate-2 | validator | Same + prior report context                  |
| Repair   | repair     | Fix recipes, minimal patches                 |

All content comes from `knowledge-base/index/corpusIndex.js` and `prompt-library/promptsBundle.js`. No runtime dependency on external doc servers.
