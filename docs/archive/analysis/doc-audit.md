# Documentation layer audit (cleanup)

## 1. Audit table

| path | status | why | cross-links affected |
|------|--------|-----|----------------------|
| README.md | ACTIVE | Root entrypoint; references config, KB, prompt-library, troubleshooting, QA, release. | Links to docs/*.md; will update if any linked doc moves. |
| config/README.md | ACTIVE | Runtime config setup; referenced from root and deployment. | docs/configuration.md, docs/secret-handling.md |
| lib/README.md | ACTIVE | CSInterface requirement; operational. | None |
| knowledge-base/README.md | ACTIVE | KB layout and usage. | docs/local-knowledge-base.md, docs/grounding-policy-by-stage.md |
| knowledge-base/assembly/README.md | ACTIVE | Assembly placeholder; reference. | None |
| prompt-library/README.md | ACTIVE | Prompt library layout. | docs/prompt-library-architecture.md |
| docs/configuration.md | ACTIVE | Current config contract. | Referenced by README, config/README, final-architecture, deployment-notes, troubleshooting, release-checklist, check-required-files.js |
| docs/secret-handling.md | ACTIVE | Secret policy. | Same as configuration |
| docs/final-architecture.md | ACTIVE | Implemented architecture. | configuration, secret-handling, pipeline-runtime-flow, final-result-policy, chat-publication-policy, manual-apply-policy, host-bridge-notes, runtime-diagnostics, troubleshooting, repository-validation, release-checklist |
| docs/final-target-architecture.md | ACTIVE | Design reference; still cited. | runtime-state-schema; cursor-prompts, risk-register (archived) |
| docs/pipeline-runtime-flow.md | ACTIVE | Pipeline stages and models. | final-result-policy, manual-apply-policy |
| docs/final-disposition-policy.md | ACTIVE | Disposition and Apply. | manual-apply-policy, chat-publication-policy, final-result-policy |
| docs/final-result-policy.md | ACTIVE | Result publication. | pipeline-runtime-flow |
| docs/chat-publication-policy.md | ACTIVE | Final-only chat. | final-disposition-policy, manual-apply-policy |
| docs/prompt-library-architecture.md | ACTIVE | Prompt library runtime. | None |
| docs/local-knowledge-base.md | ACTIVE | KB structure. | grounding-policy-by-stage |
| docs/grounding-policy-by-stage.md | ACTIVE | Stage grounding. | None |
| docs/runtime-diagnostics.md | ACTIVE | Diagnostics API. | final-disposition-policy, final-architecture, troubleshooting |
| docs/runtime-state-schema.md | ACTIVE | Session/pipeline schema. | risk-register (archived) |
| docs/manual-apply-policy.md | ACTIVE | Apply behavior. | host-bridge-notes, final-disposition-policy, chat-publication-policy, troubleshooting |
| docs/host-bridge-notes.md | ACTIVE | Host bridge. | manual-apply-policy |
| docs/repository-validation.md | ACTIVE | Validation scripts. | release-checklist, troubleshooting, final-architecture |
| docs/release-checklist.md | ACTIVE | Release checklist. | qa-test-plan, manual-test-matrix, deployment-notes |
| docs/qa-test-plan.md | ACTIVE | QA scenarios. | manual-test-matrix, troubleshooting, release-checklist |
| docs/troubleshooting.md | ACTIVE | Troubleshooting. | configuration, runtime-diagnostics, manual-apply-policy, final-result-policy, host-bridge-notes, repository-validation, qa-test-plan |
| docs/stage-2-refactor-report.md | ARCHIVE | Stage 2 implementation report. | pipeline-preparation-notes (archived), cursor-prompts |
| docs/stage-3-implementation-report.md | ARCHIVE | Stage 3 implementation report. | None |
| docs/stage-4-implementation-report.md | ARCHIVE | Stage 4 implementation report. | None |
| docs/stage-5-hardening-report.md | ARCHIVE | Stage 5 hardening report. | Many docs (internal refs; file moves to archive) |
| docs/staged-implementation-plan.md | ARCHIVE | Multi-stage plan. | pipeline-preparation-notes, cursor-prompts (all stages) |
| docs/pipeline-preparation-notes.md | ARCHIVE | Stage 2 tech notes. | staged-implementation-plan, stage-2-refactor-report |
| docs/current-repo-analysis.md | ARCHIVE | Repo analysis snapshot. | cursor-prompts |
| docs/risk-register.md | ARCHIVE | Risk register for pipeline work. | runtime-state-schema; cursor-prompts |
| docs/manual-test-matrix.md | ARCHIVE | QA matrix; release sign-off. | qa-test-plan, release-checklist, README |
| docs/deployment-notes.md | ARCHIVE | Install/packaging notes. | config/README, configuration, secret-handling, release-checklist |

cursor-prompts/* (README, shared-project-context, stage-*-build.md): dev-only; reference archived docs. Links updated to docs/archive/...

## 2. Proposed target structure

```
docs/
  README.md                    (new: doc map)
  configuration.md
  secret-handling.md
  final-architecture.md
  final-target-architecture.md
  pipeline-runtime-flow.md
  final-disposition-policy.md
  final-result-policy.md
  chat-publication-policy.md
  prompt-library-architecture.md
  local-knowledge-base.md
  grounding-policy-by-stage.md
  runtime-diagnostics.md
  runtime-state-schema.md
  manual-apply-policy.md
  host-bridge-notes.md
  repository-validation.md
  release-checklist.md
  qa-test-plan.md
  troubleshooting.md
  archive/
    README.md                  (new: archive rules)
    reports/
      stage-2-refactor-report.md
      stage-3-implementation-report.md
      stage-4-implementation-report.md
      stage-5-hardening-report.md
    plans/
      staged-implementation-plan.md
      pipeline-preparation-notes.md
      deployment-notes.md
    analysis/
      current-repo-analysis.md
      risk-register.md
    qa/
      manual-test-matrix.md
```

## 3. Link update plan

- README.md: docs/manual-test-matrix.md → docs/archive/qa/manual-test-matrix.md
- docs/release-checklist.md: docs/manual-test-matrix.md → docs/archive/qa/manual-test-matrix.md
- docs/qa-test-plan.md: docs/manual-test-matrix.md → docs/archive/qa/manual-test-matrix.md
- cursor-prompts/README.md: docs/current-repo-analysis.md → docs/archive/analysis/current-repo-analysis.md; docs/final-target-architecture.md (stays); docs/staged-implementation-plan.md → docs/archive/plans/staged-implementation-plan.md; docs/risk-register.md → docs/archive/analysis/risk-register.md; docs/stage-2-refactor-report.md → docs/archive/reports/stage-2-refactor-report.md
- cursor-prompts/shared-project-context.md: docs/final-target-architecture.md (stays); docs/staged-implementation-plan.md → docs/archive/plans/...; docs/risk-register.md → docs/archive/analysis/...
- cursor-prompts/stage-2-build.md, stage-3-build.md, stage-4-build.md: docs/staged-implementation-plan.md → docs/archive/plans/...
- cursor-prompts/stage-3-build.md: docs/runtime-state-schema.md (stays)
- In moved files under docs/archive/: update links to active docs (e.g. ../configuration.md or ../../configuration.md depending on depth).
