# Archived documentation

Historical implementation reports, planning artifacts, and one-off analysis. Preserved for context; **not** the source of truth for current behavior.

## Rules

- **Do not use these for current operations.** Use the [active docs](../README.md) in `docs/` instead.
- **New historical material:** Add to the appropriate subfolder and list below.
- **Links:** Archived docs may link to active docs via relative paths (e.g. `../../configuration.md`).

## Contents

### reports/

Stage implementation and hardening reports:

- [stage-2-refactor-report.md](reports/stage-2-refactor-report.md) — Stage 2 infrastructure refactor.
- [stage-3-implementation-report.md](reports/stage-3-implementation-report.md) — Multi-pass pipeline implementation.
- [stage-4-implementation-report.md](reports/stage-4-implementation-report.md) — Knowledge base and prompt library.
- [stage-5-hardening-report.md](reports/stage-5-hardening-report.md) — Hardening, diagnostics, QA, release prep.

### plans/

Planning and deployment artifacts:

- [staged-implementation-plan.md](plans/staged-implementation-plan.md) — Multi-stage implementation plan (stages 2–4).
- [pipeline-preparation-notes.md](plans/pipeline-preparation-notes.md) — Stage 2 technical notes for implementers.
- [deployment-notes.md](plans/deployment-notes.md) — Install, config, host script, packaging (see [release checklist](../release-checklist.md) for current release steps).

### analysis/

One-off analysis and risk registers:

- [current-repo-analysis.md](analysis/current-repo-analysis.md) — Repo analysis snapshot (pre multi-pass).
- [risk-register.md](analysis/risk-register.md) — Risk register for pipeline implementation.
- [doc-audit.md](analysis/doc-audit.md) — Audit record for documentation cleanup (archive vs active).
- [prompt-kb-gap-report.md](analysis/prompt-kb-gap-report.md) — Prompt and KB gap report; safe improvements.
- [pipeline-hardening-checklist.md](analysis/pipeline-hardening-checklist.md) — Pipeline hardening manual test checklist.
- [ae-expressions-audit.md](analysis/ae-expressions-audit.md) — AE expressions vs generic JavaScript audit; prompt/KB alignment.
- [doc-consolidation-plan.md](analysis/doc-consolidation-plan.md) — Final documentation consolidation plan.

### qa/

QA artifacts used for release sign-off (compact matrix; full scenarios remain in active [qa-test-plan.md](../qa-test-plan.md)):

- [manual-test-matrix.md](qa/manual-test-matrix.md) — Compact pass/fail matrix; use with [qa-test-plan.md](../qa-test-plan.md).
