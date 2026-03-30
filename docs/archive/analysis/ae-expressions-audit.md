# AE Expressions prompt audit – validate against real After Effects rules

Audit of the repository’s LLM instructions against the official Adobe After Effects Expression Language and engine-specific rules. Goal: generate and validate **true After Effects expressions**, not generic JavaScript.

---

## 1. Audit summary

- **project-context.md** and **generator/system.md** state target-fit and “no DOM/Node” but do not explicitly say that an expression is **property-result code** (a single evaluated value for that property), not app or script code. This can encourage generic helper-style output.
- **Validator** does not list **JavaScript engine–specific pitfalls** from Adobe (no `this()` use thisLayer; no snake_case; Source Text character access requires `.value`; strict if/else; expression cannot end in a function declaration). So the model may not flag legacy/invalid syntax.
- **Prompts** sometimes say “JavaScript expression engine” or “JavaScript-style” without anchoring in “**After Effects expression language**,” which can blur the line with generic JavaScript.
- **KB** covers globals, targeting, and patterns but lacks a short **engine pitfalls** topic (this vs thisLayer, snake_case vs camelCase, Source Text `.value`, if/else, last-statement value). Repair recipes mention forbidden IDs but not these syntax fixes.
- **Source priority** (Adobe primary, docsforadobe secondary) is stated in docs/local-knowledge-base.md and in systemPrompt; project-context and grounding templates could state it in one sentence for consistency.
- **Return type / single value**: Generator and validator say “Position expects array, Slider number” but do not state that **the expression must evaluate to a single value of the correct type** (no side-effect-only or script-style code).

Implemented: smallest safe edits to project-context, generator/system, validator/system, repair/system, expression-basics.md, repair-fix-recipes.md, corpusIndex.js, promptsBundle.js, and systemPrompt.js. No stage order, disposition, or host logic changed.

---

## 2. Gap table

| Issue | Why it is wrong for AE expressions | Affected files | Category | Severity | Smallest safe fix |
|-------|------------------------------------|----------------|----------|----------|--------------------|
| Expression not framed as property-result code | AE expressions are evaluated to produce **one value** for the property (number/array/string etc.). Generic “write code” encourages helpers with no final value or script-style logic. | project-context.md, generator/system.md | prompt | Medium | Add sentence: expression must evaluate to a single value of the correct type for the property. |
| No engine-specific syntax rules in validator | Adobe: no `this()` (use thisLayer); no snake_case (this_comp → thisComp); Source Text use text.sourceText.value[i]; if/else strict (brackets, explicit else); expression cannot end in a function declaration. Validator may pass invalid engine syntax. | validator/system.md, KB expression_basics | prompt, KB | Medium | Add engine pitfalls to validator system and to expression-basics (body/snippets) and corpusIndex. |
| “JavaScript-style” wording | Suggests “any JavaScript”; AE expression language is AE-specific (globals, return type, no DOM/Node). | systemPrompt.js | prompt | Low | Replace “JavaScript-style After Effects expression code” with “After Effects expression code” or “AE expression language.” |
| Repair doesn’t mention this()/snake_case/Source Text .value | Repair may not fix legacy engine issues. | repair/system.md, repair-fix-recipes.md, corpusIndex repair_fix_recipes | prompt, KB | Medium | Add fix recipes: this()→thisLayer; snake_case→camelCase; Source Text character access use .value. |
| Primary vs secondary source not in shared prompt | Consistency: generator/validator should know Adobe is primary, docsforadobe secondary. | project-context.md (or grounding) | prompt | Low | One sentence in project-context: Adobe Expression Language Reference is primary; docsforadobe is secondary for structure and examples. |
| Return type stated but not “single evaluated value” | “Position expects array” is good; adding “expression must evaluate to that value” blocks script-style or declaration-only output. | generator/system.md | prompt | Low | Add: expression must evaluate to a single value of the correct type (no script-only or declaration-only output). |

---

## 3. AE Expressions are not generic JavaScript

Rules the repository prompts must enforce:

1. **Property-result only**  
   An expression is evaluated in the context of **one property**. Its result must be a **single value** of the type that property expects (number for Slider/Opacity/Rotation; array for Position/Scale; string or text-related for Source Text). No “app” code, no script that only has side effects or declarations without a final value.

2. **AE globals and APIs only**  
   Use only documented AE expression globals and methods: thisComp, thisLayer, thisProperty, parent, time, value, velocity, transform, effect(), valueAtTime(), wiggle(), loopOut(), ease(), linear(), sourceRectAtTime(), and other documented APIs. No app, $, document, window, require, File, Folder, or other host/browser/Node globals.

3. **Target property type and shape**  
   Position: [x, y] or [x, y, z]. Scale: array. Rotation: degrees (number). Opacity: 0–100. Slider Control: number. Source Text: string or documented text value. Validator must set target_ok false when the expression is for a different property or returns the wrong type.

4. **JavaScript engine syntax (AE 26 / V8)**  
   - Do **not** use `this()`; use **thisLayer** (e.g. thisLayer(5)(2) for layer index and property).  
   - Do **not** use deprecated snake_case (this_comp, to_world, etc.); use **camelCase** (thisComp, toWorld).  
   - **Source Text** character access: use **text.sourceText.value[i]** in the JavaScript engine, not text.sourceText[i].  
   - **if/else**: use strict JavaScript syntax; use brackets and explicit else where required; ternary is allowed.  
   - The **last evaluated statement** must **return** the property value; the expression cannot end in a function declaration only.

5. **Vector and array handling**  
   For array properties (Position, Scale), use arrays and, when doing math, use AE vector helpers (add, sub, mul, div, etc.) or documented patterns. Match dimensions (2D vs 3D) to the layer and property.

6. **No generic “JavaScript” or “script” behavior**  
   Do not suggest browser/Node APIs, DOM, file I/O, or multi-step scripting. Do not output ExtendScript/JSX for expression requests. Expressions are evaluated every frame for one property; keep logic property-focused and expression-language-only.

---

## 4. Official Adobe vs Community Reference

- **Primary authority**: **Adobe Help Center / official Adobe After Effects Expression Language Reference** (e.g. “Expression language in After Effects”, “Syntax differences between expression engines”). This defines the AE expression language, globals, methods, return types, and JavaScript vs Legacy ExtendScript rules. When the docs conflict with other sources or with model training, **prefer Adobe**.
- **Secondary / community**: **docsforadobe After Effects Expression Reference** (and mirrors such as ae-expressions.docsforadobe.dev). Use for:
  - Structure and navigation (topics, method lists).  
  - Examples and common patterns.  
  - Warnings, version notes, and coverage gaps that align with Adobe.  
- **Repository usage**: Content in `knowledge-base/corpus/adobe/` is derived from Adobe (primary). Content in `knowledge-base/corpus/docsforadobe/` is the secondary mirror. Prompt-library and grounding templates should treat the injected KB as authoritative for the request; when both Adobe and docsforadobe are cited, prefer Adobe wording for normative rules (syntax, engine differences, forbidden APIs) and use docsforadobe for patterns and examples that match Adobe.

---

## 5. Files changed (see below for safety)

- docs/archive/analysis/ae-expressions-audit.md (this file)
- prompt-library/shared/project-context.md
- prompt-library/generator/system.md
- prompt-library/validator/system.md
- prompt-library/repair/system.md
- prompt-library/promptsBundle.js
- knowledge-base/corpus/adobe/expression-basics.md
- knowledge-base/corpus/docsforadobe/repair-fix-recipes.md
- knowledge-base/index/corpusIndex.js
- systemPrompt.js

---

## 6. Why each change is safe

- **project-context**: Additive sentences only (property-result, Adobe primary). No change to output contract or stage flow.
- **generator/system**: Additive bullet (evaluate to single value of correct type). No format or disposition change.
- **validator/system**: Additive engine-pitfall bullets. Still outputs same report schema; only flags more invalid syntax.
- **repair/system**: Additive fix recipes. Same output contract.
- **promptsBundle.js**: Text synced to .md; no new keys or structure.
- **expression-basics.md / corpusIndex expression_basics**: Add engine pitfalls; snippets additive. No projection order change.
- **repair-fix-recipes.md / corpusIndex repair_fix_recipes**: Add snippets for this()/snake_case/Source Text .value. Additive.
- **systemPrompt.js**: One phrase change (JavaScript-style → AE expression). Same structure and format; clarifies intent only.

No changes to: stage order, final-only publication, manual Apply, host bridge, config, disposition semantics.

---

## 7. Validation results

- `node scripts/validate-repo.js`: Repository structure OK.
- `node scripts/check-required-files.js`: Prompt library, Knowledge base, Config, Docs OK; all required files present.

---

## 8. Remaining gaps

- **Vector math**: Prompts mention “array” and “Position” but do not explicitly say “use add(), sub(), mul(), div() for array math where appropriate.” Could add one line to expression-basics or targeting in a future pass.
- **Camera / 3D / world-space**: No dedicated KB topic; generator/validator rely on general targeting. Acceptable for current scope; add only if product expands into 3D-heavy workflows.
- **Expression engine version in UI**: project-context says “After Effects 26.0+”; no runtime check. Out of scope for this audit.
- **Full Adobe doc inline**: Grounding uses local KB only; no live fetch of Adobe. By design; no change.

---

## 9. Manual QA scenarios to rerun (docs/qa-test-plan.md)

After prompt/KB changes, rerun these to confirm no user-facing regression:

- **§1 Startup:** 1 (Panel launch), 2 (Missing config), 3 (Valid config).
- **§4 Pipeline:** 14 (Successful generation) — one assistant message, Apply enabled for acceptable result.
- **§5 Blocked/warning/repair:** 15 (Blocked result), 16 (Warned draft), 17 (Repair path).
- **§6 Failure:** 18 (Missing config at Send), 19 (Network failure), 20 (Malformed response).
- **§7 Apply:** 21 (Apply success), 22 (Apply invalid target).
- **§8 Final checks:** 24 (No auto-apply), 25 (Final-only output — one message per send; no intermediate pipeline messages).

**Confirmation:** Stage order, final-only publication, manual Apply policy, host bridge logic, config loading, and disposition semantics are unchanged. Working extension behavior is preserved; only prompt and KB content were updated to anchor generation/validation/repair in real AE expression rules.
