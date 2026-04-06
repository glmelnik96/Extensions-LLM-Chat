# Removed active redirects (2026-04)

This note tracks legacy redirect documents removed from the active `docs/` folder during documentation cleanup.

These files did not contain active product behavior. They only redirected to archive files and created noise in the active docs map.

## Removed from active docs

- `docs/final-target-architecture.md`
- `docs/pipeline-runtime-flow.md`
- `docs/final-disposition-policy.md`
- `docs/final-result-policy.md`
- `docs/manual-apply-policy.md`
- `docs/grounding-policy-by-stage.md`

## Canonical archive targets

- `multi-pass-copilot-legacy/legacy-multi-pass-target-architecture.md`
- `multi-pass-copilot-legacy/legacy-pipeline-runtime-flow-stages-and-models.md`
- `multi-pass-copilot-legacy/legacy-final-disposition-and-apply-policy.md`
- `multi-pass-copilot-legacy/legacy-final-result-publication-policy.md`
- `multi-pass-copilot-legacy/legacy-manual-apply-expression-policy.md`
- `multi-pass-copilot-legacy/legacy-grounding-policy-by-pipeline-stage.md`

## Why this was done

- Keep active docs focused on the shipping AE Motion Agent behavior.
- Keep legacy multi-pass documentation in one place (archive) without duplicate redirect stubs.
- Reduce maintenance overhead when validating docs and links.
