# Prompt and KB layer gap report

One-time audit to align prompts and local KB with the documented design without changing product behavior.

---

## 1. Prompt audit summary

### Generator
- **Target-fit / output discipline:** Source .md is clear; bundle abbreviates. Missing: explicit ban on markdown code fences (```) and requirement that expression inside ---STRUCTURED--- JSON match the expression block exactly. Models sometimes output fences or slight variants, which can break parsing or deterministic rules.
- **Self-check / AE style:** Self_check_status and style guidance present. Safe improvement: state "no code fences anywhere" and "JSON expression must match block exactly" in generator system.

### Validator
- **Correctness / report schema:** Report schema and system instructions are clear. Missing: explicit instruction that the JSON between ---REPORT--- and ---END--- must be **raw** (no markdown code fences). Parsing in main.js uses tryParseJsonBlock; wrapped ```json breaks it and yields status "unknown".
- **Target match / invariants:** target_ok and ae_invariants_checked are documented. No change needed.

### Repair
- **Minimal patching / output discipline:** Patching policy and system are clear. Missing: one explicit line that repair output must contain **only** expression + ---EXPLANATION--- + bullets, and **no** ---STRUCTURED---, ---REPORT---, or JSON. Reduces risk of repair drifting into validator-style output.

### Shared (project-context, output-contracts, targeting-rules)
- **Output contracts:** Validator section should state "Output raw JSON between markers; do not wrap in ```." so all roles see it.
- **Targeting rules:** Adequate. property_targeting_constraints in KB could explicitly mention Effect > Slider (Slider Control) as number.

---

## 2. KB audit summary

### Coverage
- **Generator:** expression_basics, wiggle/valueAtTime/posterizeTime, sourceText/sourceRectAtTime, property_targeting_constraints, common_patterns — good. property_targeting_constraints body in corpusIndex could mention Slider Control (number) explicitly.
- **Validator:** Same topics; order emphasizes target and correctness. Forbidden-APIs list appears in expression_basics and repair_fix_recipes but could be one explicit snippet for quick lookup.
- **Repair:** repair_fix_recipes, wiggle, property_targeting_constraints, common_patterns. repair_fix_recipes .md has "Missing semicolons / syntax"; corpusIndex could add a snippet "Add semicolons only where required; do not refactor the rest."

### Source vs runtime
- **corpusIndex.js** bodies/snippets are condensed from the .md files; topic IDs match projections. No structural drift. Minor enrichment: add one snippet to expression_basics (forbidden APIs), one to repair_fix_recipes (semicolons / no refactor), and extend property_targeting_constraints body to include Slider.

### Projection usefulness
- Generator and validator projections match docs/grounding-policy-by-stage.md. Repair leads with repair_fix_recipes. No change to projection order.

---

## 3. Implementation summary (completed)

### Files changed
- **Prompt source:** `prompt-library/shared/output-contracts.md`, `prompt-library/validator/report-schema.md`, `prompt-library/generator/system.md`, `prompt-library/repair/system.md`, `prompt-library/validator/system.md`
- **Bundle:** `prompt-library/promptsBundle.js` (shared.outputContracts, generator.system, validator.system, validator.reportSchema, repair.system)
- **KB:** `knowledge-base/index/corpusIndex.js` (expression_basics snippets, property_targeting_constraints body, repair_fix_recipes snippets)
- **Doc:** `docs/archive/analysis/prompt-kb-gap-report.md` (this file)

### Why each change is safe
- **No-fences / raw-JSON wording:** Clarifies existing contract; parser already expects raw JSON and plain expression text. Reduces malformed output; does not change stage order, disposition, or Apply.
- **Generator “expression in JSON must match block”:** Already in source; bundle now states it explicitly. Aligns model output with deterministic rules; no API change.
- **Repair “no JSON, no ---REPORT---, no ---STRUCTURED---”:** Makes repair output contract explicit; extractExpressionFromResponse unchanged.
- **KB snippet/body enrichment:** Additive only; projections and topic list unchanged. Improves grounding; no behavior change to pipeline logic.

### Validation results
- `node scripts/validate-repo.js`: **Repository structure OK** (exit 0).
- `node scripts/check-required-files.js`: **Prompt library: OK, Knowledge base: OK, Config: OK, Docs (expected): OK. All required files present.** (exit 0).

### QA scenarios to rerun (prompt/KB content changed)
From `docs/qa-test-plan.md`, rerun:
- **§4 Pipeline happy path:** 14. Successful generation
- **§5 Blocked / warning / repair paths:** 15. Blocked result (rules), 16. Warned draft, 17. Repair path
- **§7 Manual Apply:** 21. Apply success (sanity check; no logic change)

No change to final-only publication or manual Apply policy; stages and disposition semantics unchanged.

### Remaining gaps not fixed in this pass
- projectContext in promptsBundle still omits “You may explain in the user’s language” (minor; shared project-context.md has it).
- No new corpus .md files or new projection topics; only in-index enrichment.
- If validator still occasionally wraps JSON in fences, consider a fallback strip in tryParseJsonBlock (out of scope for this pass).

---

## 4. Gaps (issue → affected files → impact → smallest safe fix)

| Issue | Affected files | Impact | Smallest safe fix |
|-------|----------------|--------|-------------------|
| Validator JSON wrapped in ``` | report-schema.md, output-contracts.md, promptsBundle validator | parseValidatorStructuredReport returns null → status "unknown" → more warned_draft/blocked | Add "raw JSON only; no code fences" to schema and contract; bundle same. |
| Generator expression or JSON in fences | generator/system.md, promptsBundle generator | runDeterministicRules blocks; parseGeneratorStructuredResponse may fail | Add "no markdown code fences; expression in JSON must match block" to generator system; bundle same. |
| Repair outputs JSON or wrong markers | repair/system.md, promptsBundle repair | extractExpressionFromResponse can fail; wrong format | Add "only expression + ---EXPLANATION--- + bullets; no JSON/---REPORT---/---STRUCTURED---"; bundle same. |
| property_targeting_constraints missing Slider | corpusIndex.js property_targeting_constraints | Generator/validator may be vague on Slider type | Add "Slider Control / Effect > Slider: number" to body. |
| Repair snippet for semicolons / no refactor | corpusIndex.js repair_fix_recipes | Repair may over-rewrite | Add snippet "Add semicolons only where required; do not refactor the rest." |
| Forbidden APIs as single checklist | corpusIndex.js expression_basics snippets | Validator/repair lookup | Add snippet "Forbidden in expressions: app, $, document, window, require, File, Folder, system.callSystem." |

---

## 5. Not changed in this pass

- Stage order, disposition semantics, final-only publication, manual Apply, host bridge, config, model roles.
- pipelineAssembly.js (no logic change).
- Projection topic lists or order (only content enrichment in corpusIndex).
- New corpus topics or new .md files (only edits to existing prompt .md and corpusIndex content).
