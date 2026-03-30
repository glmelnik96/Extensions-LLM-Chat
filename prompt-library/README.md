# Prompt Library

Role-specific prompt library for the multi-pass pipeline. Used by the extension to assemble grounded prompts for generator, validator, and repair passes. All content is local and inspectable.

## Layout

- **shared/** — Project context, output contracts, and targeting rules used across roles.
- **generator/** — System instructions and grounding template for the generator pass.
- **validator/** — System instructions, grounding template, and report schema for validator passes.
- **repair/** — System instructions, grounding template, and patching policy for repair passes.
- **agent/** — Placeholder for **Phase 7** agent/tool-loop prompts (not loaded by the pipeline today). See **agent/README.md**.

## Runtime loading

The extension loads prompt content via **prompt-library/promptsBundle.js** (single script that exposes `window.PIPELINE_PROMPTS`). The .md files in each folder are the source of truth for maintainers; the bundle is kept in sync for runtime. If the bundle is missing or incomplete, the extension falls back to built-in defaults so the panel remains usable.

## Rules

- Generator returns structured output (expression + ---EXPLANATION--- + ---STRUCTURED--- JSON ---END---).
- Validators return normalized reports (---REPORT--- JSON ---END---).
- Repair is patch-oriented; do not rewrite unnecessarily. Output: expression + ---EXPLANATION--- bullets only.
- Target context (layer, property) must be respected in all roles. Final output must remain compatible with the extension UI (expression extraction, manual Apply only).
